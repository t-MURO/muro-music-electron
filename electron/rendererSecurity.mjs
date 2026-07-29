import path from "node:path";
import { fileURLToPath } from "node:url";

export const createTrustedRendererUrlCheck = ({
  developmentUrl,
  productionRendererPath,
}) => {
  const developmentOrigin = developmentUrl
    ? new URL(developmentUrl).origin
    : null;
  const productionPath = path.resolve(productionRendererPath);

  return (rawUrl) => {
    try {
      const url = new URL(rawUrl);
      if (developmentOrigin) return url.origin === developmentOrigin;
      return url.protocol === "file:"
        && path.resolve(fileURLToPath(url)) === productionPath;
    } catch {
      return false;
    }
  };
};
