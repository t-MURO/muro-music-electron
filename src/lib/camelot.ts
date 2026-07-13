// Camelot wheel mapping for DJ-friendly key notation

const camelotMap: Record<string, string> = {
  // Major keys (B suffix)
  "C major": "8B",
  "G major": "9B",
  "D major": "10B",
  "A major": "11B",
  "E major": "12B",
  "B major": "1B",
  "F# major": "2B",
  "Gb major": "2B",
  "Db major": "3B",
  "C# major": "3B",
  "Ab major": "4B",
  "G# major": "4B",
  "Eb major": "5B",
  "D# major": "5B",
  "Bb major": "6B",
  "A# major": "6B",
  "F major": "7B",

  // Minor keys (A suffix)
  "A minor": "8A",
  "E minor": "9A",
  "B minor": "10A",
  "F# minor": "11A",
  "Gb minor": "11A",
  "C# minor": "12A",
  "Db minor": "12A",
  "G# minor": "1A",
  "Ab minor": "1A",
  "D# minor": "2A",
  "Eb minor": "2A",
  "A# minor": "3A",
  "Bb minor": "3A",
  "F minor": "4A",
  "C minor": "5A",
  "G minor": "6A",
  "D minor": "7A",
};

export function toCamelot(key: string, scale: string): string {
  const fullKey = `${key} ${scale}`;
  return camelotMap[fullKey] || "?";
}

export function keyToCamelot(keyString: string): string {
  return camelotMap[keyString] || "?";
}

// Get the musical key from Camelot notation (reverse lookup)
export function fromCamelot(camelot: string): string | null {
  for (const [key, value] of Object.entries(camelotMap)) {
    if (value === camelot) {
      return key;
    }
  }
  return null;
}
