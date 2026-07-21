import assert from "node:assert/strict";
import {
  encodeCastMessage,
  decodeCastMessage,
  frameCastMessage,
  createFrameReader,
  MAX_CAST_FRAME_BYTES,
} from "../electron/cast/castProtocol.mjs";
import {
  buildPtrQuery,
  parseDnsMessage,
  parseTxtEntries,
  collectCastRecords,
  CAST_SERVICE_NAME,
} from "../electron/cast/castDiscovery.mjs";

// --- CastMessage protobuf roundtrip -----------------------------------------

const original = {
  sourceId: "sender-0",
  destinationId: "receiver-0",
  namespace: "urn:x-cast:com.google.cast.tp.connection",
  payloadUtf8: JSON.stringify({ type: "CONNECT", note: "ümlaut ✓" }),
};
const decoded = decodeCastMessage(encodeCastMessage(original));
assert.equal(decoded.sourceId, original.sourceId);
assert.equal(decoded.destinationId, original.destinationId);
assert.equal(decoded.namespace, original.namespace);
assert.equal(decoded.payloadUtf8, original.payloadUtf8);
assert.equal(decoded.protocolVersion, 0);
assert.equal(decoded.payloadType, 0);

// --- Frame reader handles split and coalesced frames ------------------------

const first = frameCastMessage(encodeCastMessage({ ...original, payloadUtf8: "{\"n\":1}" }));
const second = frameCastMessage(encodeCastMessage({ ...original, payloadUtf8: "{\"n\":2}" }));
const received = [];
const readFrames = createFrameReader((message) => received.push(decodeCastMessage(message).payloadUtf8));

readFrames(first.subarray(0, 3));
assert.equal(received.length, 0);
readFrames(Buffer.concat([first.subarray(3), second]));
assert.deepEqual(received, ["{\"n\":1}", "{\"n\":2}"]);

const oversizedFrame = Buffer.alloc(4);
oversizedFrame.writeUInt32BE(MAX_CAST_FRAME_BYTES + 1);
assert.throws(() => readFrames(oversizedFrame), /exceeds sane size/);

// --- mDNS query shape -------------------------------------------------------

const query = buildPtrQuery(CAST_SERVICE_NAME, { unicastResponse: true });
assert.equal(query.readUInt16BE(4), 1); // one question
assert.equal(query.readUInt16BE(query.length - 4), 12); // PTR
assert.equal(query.readUInt16BE(query.length - 2), 0x8001); // QU bit + IN

// --- mDNS response parsing with name compression ----------------------------

const encodeName = (name) => Buffer.concat([
  ...name.split(".").map((label) => {
    const bytes = Buffer.from(label, "utf8");
    return Buffer.concat([Buffer.from([bytes.length]), bytes]);
  }),
  Buffer.from([0]),
]);
const pointerTo = (offset) => Buffer.from([0xc0 | (offset >> 8), offset & 0xff]);
const uint16 = (value) => {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16BE(value, 0);
  return buffer;
};
const uint32 = (value) => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value, 0);
  return buffer;
};
const record = (nameBuffer, type, rdata) =>
  Buffer.concat([nameBuffer, uint16(type), uint16(1), uint32(120), uint16(rdata.length), rdata]);

const header = Buffer.concat([
  uint16(0), // id
  uint16(0x8400), // response flags
  uint16(0), // no questions
  uint16(4), // four answers
  uint16(0),
  uint16(0),
]);

// The PTR record's own name field holds the service name at offset 12, so
// 0xC00C pointers in later records reference it.
const serviceName = encodeName(CAST_SERVICE_NAME);
const serviceNameOffset = 12;

// PTR rdata: instance label plus a pointer back to the service name.
const instanceLabel = Buffer.from("Wohnzimmer TV", "utf8");
const ptrRdata = Buffer.concat([
  Buffer.from([instanceLabel.length]),
  instanceLabel,
  pointerTo(serviceNameOffset),
]);
const ptrRecord = record(serviceName, 12, ptrRdata);
// The instance name starts where the PTR rdata starts: after the header, the
// record's name + type + class + ttl + rdlength.
const instanceNameOffset = 12 + serviceName.length + 2 + 2 + 4 + 2;

const srvRdata = Buffer.concat([uint16(0), uint16(0), uint16(8009), encodeName("chromecast-abc.local")]);
const srvRecord = record(pointerTo(instanceNameOffset), 33, srvRdata);

const txtRdata = Buffer.concat(
  ["id=uuid-1234", "fn=Wohnzimmer TV", "md=Chromecast Ultra"].map((entry) => {
    const bytes = Buffer.from(entry, "utf8");
    return Buffer.concat([Buffer.from([bytes.length]), bytes]);
  }),
);
const txtRecord = record(pointerTo(instanceNameOffset), 16, txtRdata);

const aRecord = record(encodeName("chromecast-abc.local"), 1, Buffer.from([192, 168, 1, 42]));

const response = Buffer.concat([header, ptrRecord, srvRecord, txtRecord, aRecord]);
const records = parseDnsMessage(response);
assert.equal(records.length, 4);
assert.equal(records[0].domain, `Wohnzimmer TV.${CAST_SERVICE_NAME}`);
assert.equal(records[1].port, 8009);
assert.equal(records[1].target, "chromecast-abc.local");
assert.equal(records[3].address, "192.168.1.42");

assert.deepEqual(parseTxtEntries(["id=abc", "flag", "x=1=2"]), { id: "abc", x: "1=2" });

const devices = collectCastRecords(records);
assert.equal(devices.length, 1);
assert.deepEqual(devices[0], {
  id: "uuid-1234",
  name: "Wohnzimmer TV",
  model: "Chromecast Ultra",
  host: "192.168.1.42",
  port: 8009,
});

// A response missing the A record yields no device instead of a broken one.
const withoutAddress = parseDnsMessage(
  Buffer.concat([
    Buffer.concat([uint16(0), uint16(0x8400), uint16(0), uint16(3), uint16(0), uint16(0)]),
    ptrRecord,
    srvRecord,
    txtRecord,
  ]),
);
assert.equal(collectCastRecords(withoutAddress).length, 0);

const abusiveRecordCount = Buffer.alloc(12);
abusiveRecordCount.writeUInt16BE(4097, 6);
assert.throws(() => parseDnsMessage(abusiveRecordCount), /record count exceeds sane limit/);

const truncatedQuestion = Buffer.alloc(13);
truncatedQuestion.writeUInt16BE(1, 4);
assert.throws(() => parseDnsMessage(truncatedQuestion), /Truncated DNS question/);

console.log("Cast protocol smoke test passed.");
