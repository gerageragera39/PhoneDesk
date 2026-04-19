import os from "node:os";

export type SupportedPlatform = "windows" | "linux";

export class PlatformDetector {
  public static detectPlatform(): SupportedPlatform {
    if (process.platform === "win32") {
      return "windows";
    }

    if (process.platform === "linux") {
      return "linux";
    }

    throw new Error(`Unsupported platform: ${process.platform}. PhoneDesk currently supports only Windows and Linux.`);
  }

  public static getLocalNetworkIp(): string {
    const interfaces = os.networkInterfaces();

    for (const entries of Object.values(interfaces)) {
      if (!entries) {
        continue;
      }

      for (const net of entries) {
        if (net.internal || net.family !== "IPv4") {
          continue;
        }

        if (
          net.address.startsWith("192.168.") ||
          net.address.startsWith("10.") ||
          /^172\.(1[6-9]|2\d|3[01])\./.test(net.address)
        ) {
          return net.address;
        }
      }
    }

    return "127.0.0.1";
  }
}
