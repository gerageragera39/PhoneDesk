import { execFileSync } from "node:child_process";
import os from "node:os";

export type SupportedPlatform = "windows" | "linux";

export interface StartupLink {
  label: string;
  url: string;
}

interface NetworkCandidate {
  address: string;
  label: string;
  priority: number;
}

interface WindowsHostIpEntry {
  IPAddress?: string;
  InterfaceAlias?: string;
  InterfaceDescription?: string | null;
}

const PRIVATE_IPV4_REGEX = /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/;
const PREFERRED_INTERFACE_REGEX = /(wi-?fi|wlan|ethernet|en|eth|lan)/i;
const VIRTUAL_INTERFACE_REGEX = /(docker|veth|virbr|br-|virtual|vmware|vbox|hyper-v|vethernet|wsl|tailscale|zerotier|hamachi|loopback|tun|tap|podman)/i;
const WINDOWS_HOST_INTERFACE_REGEX =
  /vEthernet|WSL|Hyper-V|VirtualBox|VMware|Docker|Loopback|Tailscale|ZeroTier|Hamachi/i;
const WINDOWS_HOST_DESCRIPTION_REGEX =
  /virtualbox|vmware|hyper-v|host-only|docker|loopback|tailscale|zerotier|hamachi/i;

export class PlatformDetector {
  public static detectPlatform(): SupportedPlatform {
    if (process.platform === "win32" || this.isWsl()) {
      return "windows";
    }

    if (process.platform === "linux") {
      return "linux";
    }

    throw new Error(`Unsupported platform: ${process.platform}. PhoneDesk currently supports only Windows and Linux.`);
  }

  public static isWsl(): boolean {
    if (process.platform !== "linux") {
      return false;
    }

    const release = os.release().toLowerCase();
    return Boolean(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP || release.includes("microsoft"));
  }

  public static resolveWindowsCommand(command: string): string {
    if (!this.isWsl()) {
      return command;
    }

    return command.toLowerCase().endsWith(".exe") ? command : `${command}.exe`;
  }

  public static getStartupLinks(port: number): {
    localUrl: string;
    adminUrl: string;
    phoneLinks: StartupLink[];
  } {
    return {
      localUrl: `http://127.0.0.1:${port}`,
      adminUrl: `http://127.0.0.1:${port}/admin`,
      phoneLinks: this.getPhoneLinks(port),
    };
  }

  public static getLocalNetworkIp(): string {
    return this.getNetworkCandidates()[0]?.address ?? "127.0.0.1";
  }

  private static getPhoneLinks(port: number): StartupLink[] {
    return this.getNetworkCandidates().map((candidate) => ({
      label: candidate.label,
      url: `http://${candidate.address}:${port}`,
    }));
  }

  private static getNetworkCandidates(): NetworkCandidate[] {
    const seen = new Set<string>();

    return [...this.getWindowsHostCandidates(), ...this.getLocalInterfaceCandidates()]
      .sort((left, right) => right.priority - left.priority || left.label.localeCompare(right.label))
      .filter((candidate) => {
        if (!PRIVATE_IPV4_REGEX.test(candidate.address) || seen.has(candidate.address)) {
          return false;
        }

        seen.add(candidate.address);
        return true;
      });
  }

  private static getLocalInterfaceCandidates(): NetworkCandidate[] {
    const interfaces = os.networkInterfaces();
    const candidates: NetworkCandidate[] = [];

    for (const [name, entries] of Object.entries(interfaces)) {
      if (!entries) {
        continue;
      }

      for (const net of entries) {
        if (net.internal || net.family !== "IPv4" || !PRIVATE_IPV4_REGEX.test(net.address)) {
          continue;
        }

        let priority = 30;

        if (net.address.startsWith("192.168.")) {
          priority += 8;
        } else if (net.address.startsWith("10.")) {
          priority += 6;
        } else {
          priority += 4;
        }

        if (PREFERRED_INTERFACE_REGEX.test(name)) {
          priority += 12;
        }

        if (VIRTUAL_INTERFACE_REGEX.test(name)) {
          priority -= 24;
        }

        candidates.push({
          address: net.address,
          label: this.isWsl() ? `WSL guest (${name})` : `LAN (${name})`,
          priority,
        });
      }
    }

    return candidates;
  }

  private static getWindowsHostCandidates(): NetworkCandidate[] {
    if (!this.isWsl()) {
      return [];
    }

    const preferred = this.readWindowsHostIps(true);
    if (preferred.length > 0) {
      return preferred;
    }

    return this.readWindowsHostIps(false);
  }

  private static readWindowsHostIps(excludeVirtualAdapters: boolean): NetworkCandidate[] {
    const script = `
$items = Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object {
    $_.IPAddress -match '${PRIVATE_IPV4_REGEX.source}' -and $_.SkipAsSource -eq $false
  } |
  Sort-Object InterfaceMetric |
  Select-Object -Property IPAddress, InterfaceAlias, InterfaceIndex -Unique |
  ForEach-Object {
    $adapter = Get-NetAdapter -InterfaceIndex $_.InterfaceIndex -ErrorAction SilentlyContinue
    [PSCustomObject]@{
      IPAddress = $_.IPAddress
      InterfaceAlias = $_.InterfaceAlias
      InterfaceDescription = $adapter.InterfaceDescription
    }
  }
@($items) | ConvertTo-Json -Compress
`.trim();

    try {
      const stdout = execFileSync(
        this.resolveWindowsCommand("powershell"),
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
        { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] },
      ).trim();

      if (!stdout) {
        return [];
      }

      const parsed = JSON.parse(stdout) as WindowsHostIpEntry | WindowsHostIpEntry[];
      const entries = Array.isArray(parsed) ? parsed : [parsed];

      return entries
        .filter((entry): entry is Required<Pick<WindowsHostIpEntry, "IPAddress">> & WindowsHostIpEntry =>
          typeof entry?.IPAddress === "string" && entry.IPAddress.length > 0,
        )
        .filter((entry) => {
          if (!excludeVirtualAdapters) {
            return true;
          }

          const alias = entry.InterfaceAlias ?? "";
          const description = entry.InterfaceDescription ?? "";
          return !WINDOWS_HOST_INTERFACE_REGEX.test(alias) && !WINDOWS_HOST_DESCRIPTION_REGEX.test(description);
        })
        .map((entry) => ({
          address: entry.IPAddress,
          label: entry.InterfaceAlias
            ? `Windows host (${entry.InterfaceAlias})`
            : "Windows host LAN",
          priority: this.getWindowsHostPriority(entry),
        }));
    } catch {
      return [];
    }
  }

  private static getWindowsHostPriority(entry: WindowsHostIpEntry): number {
    const haystack = `${entry.InterfaceAlias ?? ""} ${entry.InterfaceDescription ?? ""}`.toLowerCase();

    if (/(wi-?fi|wireless|wlan)/.test(haystack)) {
      return 140;
    }

    if (/(ethernet|lan)/.test(haystack)) {
      return 120;
    }

    return 100;
  }
}
