import { execFile } from "node:child_process";
import { access, constants, readdir, readFile, stat } from "node:fs/promises";
import type { Dirent, Stats } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { AppError } from "../../shared/errors/AppError";
import type { Logger } from "../../shared/utils/Logger";
import type { SupportedPlatform } from "../../shared/utils/PlatformDetector";
import { AppsRepository } from "./AppsRepository";
import type { AppEntry, CreateAppInput, UpdateAppInput } from "./AppTypes";

const MAX_SCAN_RESULTS = 72;
const DESKTOP_EXEC_PLACEHOLDER_REGEX = /%[UuFfKk]/g;
const MAX_ICON_SOURCE_BYTES = 64 * 1024;
const MAX_ICON_DATA_URL_LENGTH = 120_000;
const ICON_EXTENSIONS = [".png", ".svg", ".jpg", ".jpeg", ".webp", ".xpm"] as const;
const ICON_MIME_TYPES: Record<(typeof ICON_EXTENSIONS)[number], string> = {
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".xpm": "image/x-xpixmap",
};
const ICON_INDEX_MAX_DEPTH = 6;
const ICON_INDEX_MAX_DIRECTORIES = 20_000;
const WINDOWS_PICKER_EXIT_CANCELLED = 2;
const WINDOWS_APP_EXTENSIONS = new Set([".exe", ".bat", ".cmd", ".com"]);
const WINDOWS_EXCLUDED_KEYWORDS = [
  "uninstall",
  "unins",
  "updater",
  "update",
  "crash",
  "report",
  "helper",
  "service",
  "telemetry",
  "setup",
  "installer",
  "install",
  "repair",
  "redistributable",
  "runtime",
  "diagnostic",
  "feedback",
  "support",
  "migration",
  "assistant",
  "notification",
  "maintenance",
  "safe mode",
  "recovery",
  "driver",
  "stub",
];
const WINDOWS_PRIORITY_KEYWORDS = [
  "visual studio",
  "vs code",
  "code",
  "chrome",
  "edge",
  "firefox",
  "brave",
  "opera",
  "netflix",
  "spotify",
  "discord",
  "slack",
  "telegram",
  "steam",
  "obs",
  "vlc",
  "docker",
  "postman",
  "figma",
  "android studio",
  "pycharm",
  "intellij",
  "webstorm",
  "datagrip",
  "rider",
  "notepad++",
  "photoshop",
  "premiere",
  "unity",
  "unreal",
  "blender",
];
const DISPLAY_NAME_BY_EXECUTABLE: Record<string, string> = {
  chrome: "Google Chrome",
  msedge: "Microsoft Edge",
  firefox: "Mozilla Firefox",
  brave: "Brave",
  opera: "Opera",
  code: "VS Code",
  devenv: "Visual Studio",
  spotify: "Spotify",
  discord: "Discord",
  telegram: "Telegram",
  slack: "Slack",
  teams: "Microsoft Teams",
  steam: "Steam",
  obs64: "OBS Studio",
  vlc: "VLC media player",
  docker: "Docker Desktop",
  postman: "Postman",
  figma: "Figma",
  pycharm64: "PyCharm",
  idea64: "IntelliJ IDEA",
  webstorm64: "WebStorm",
  datagrip64: "DataGrip",
  rider64: "Rider",
  "notepad++": "Notepad++",
  blender: "Blender",
  netflix: "Netflix",
};

interface LinuxDesktopEntry {
  name: string;
  executablePath: string;
  icon: string;
}

interface IconIndexCandidate {
  path: string;
  score: number;
}

interface ExecResult {
  stdout: string;
  stderr: string;
}

interface WindowsDiscoveryCandidate {
  name?: string;
  targetPath?: string;
  arguments?: string;
  workingDirectory?: string;
  sourcePath?: string;
}

export class AppsService {
  private linuxIconIndexPromise: Promise<Map<string, string>> | null = null;
  private readonly iconDataUrlCache = new Map<string, string>();
  private readonly resolvedIconCache = new Map<string, string>();
  private persistedIconMigrationDone = false;

  constructor(
    private readonly repository: AppsRepository,
    private readonly logger: Logger,
    private readonly platform: SupportedPlatform,
  ) {}

  public async getAppsForClient(): Promise<AppEntry[]> {
    const apps = await this.getApps();
    return this.withResolvedIcons(apps);
  }

  public async getApps(): Promise<AppEntry[]> {
    try {
      const apps = await this.repository.findAll();
      const normalizedApps = this.platform === "linux" ? await this.persistLinuxIconsIfNeeded(apps) : apps;

      return normalizedApps
        .filter((entry) => entry.platform === "both" || entry.platform === this.platform)
        .sort((left, right) => left.sortOrder - right.sortOrder);
    } catch (error) {
      this.logger.error("Failed to load applications", {
        error: error instanceof Error ? error.message : "unknown",
      });
      throw new AppError("Failed to load applications", 500, "APPS_READ_FAILED");
    }
  }

  public async getAppByIdOrThrow(id: string): Promise<AppEntry> {
    try {
      const app = await this.repository.findById(id);

      if (!app) {
        throw new AppError("Application not found", 404, "APP_NOT_FOUND", { id });
      }

      return app;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError("Failed to find application", 500, "APP_LOOKUP_FAILED", { id });
    }
  }

  public async createApp(input: CreateAppInput): Promise<AppEntry> {
    try {
      const apps = await this.repository.findAll();
      const highestOrder = apps.reduce((maxOrder, app) => Math.max(maxOrder, app.sortOrder), -1);

      const nextApp: AppEntry = {
        id: uuidv4(),
        name: input.name.trim(),
        icon: input.icon,
        executablePath: input.executablePath.trim(),
        args: input.args && input.args.length > 0 ? [...input.args] : undefined,
        workingDirectory: input.workingDirectory?.trim() || undefined,
        category: input.category?.trim() || undefined,
        sortOrder: input.sortOrder ?? highestOrder + 1,
        platform: input.platform ?? this.platform,
      };

      apps.push(nextApp);
      await this.repository.saveAll(apps);
      return nextApp;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError("Failed to add application", 500, "APP_CREATE_FAILED");
    }
  }

  public async updateApp(id: string, patch: UpdateAppInput): Promise<AppEntry> {
    try {
      const apps = await this.repository.findAll();
      const index = apps.findIndex((entry) => entry.id === id);

      if (index === -1) {
        throw new AppError("Application not found", 404, "APP_NOT_FOUND", { id });
      }

      const current = apps[index];
      const updated: AppEntry = {
        ...current,
        ...patch,
        name: patch.name?.trim() ?? current.name,
        executablePath: patch.executablePath?.trim() ?? current.executablePath,
        workingDirectory: patch.workingDirectory?.trim() || current.workingDirectory,
        category: patch.category?.trim() || current.category,
        args: patch.args ? [...patch.args] : current.args,
      };

      apps[index] = updated;
      await this.repository.saveAll(apps);
      return updated;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError("Failed to update application", 500, "APP_UPDATE_FAILED", { id });
    }
  }

  public async deleteApp(id: string): Promise<void> {
    try {
      const apps = await this.repository.findAll();
      const next = apps.filter((entry) => entry.id !== id);

      if (apps.length === next.length) {
        throw new AppError("Application not found", 404, "APP_NOT_FOUND", { id });
      }

      await this.repository.saveAll(next);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError("Failed to delete application", 500, "APP_DELETE_FAILED", { id });
    }
  }

  public async scanDefaultApps(): Promise<AppEntry[]> {
    try {
      const scanned = this.platform === "windows" ? await this.scanWindowsApps() : await this.scanLinuxApps();
      return this.withResolvedIcons(scanned);
    } catch (error) {
      this.logger.warn("Application scan failed", {
        error: error instanceof Error ? error.message : "unknown",
      });
      throw new AppError("Failed to scan applications", 500, "APP_SCAN_FAILED");
    }
  }

  public async createDraftFromSystemPicker(): Promise<CreateAppInput> {
    try {
      const executablePath =
        this.platform === "windows" ? await this.pickWindowsExecutable() : await this.pickLinuxExecutable();

      return this.buildDraftFromExecutable(executablePath);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      this.logger.warn("System file picker failed", {
        error: error instanceof Error ? error.message : "unknown",
      });
      throw new AppError("Failed to open the system file picker", 500, "APP_PICKER_FAILED");
    }
  }

  private async scanWindowsApps(): Promise<AppEntry[]> {
    const discovered = await this.scanWindowsDiscoveryCandidates();
    const ranked = new Map<string, { score: number; entry: AppEntry }>();

    for (const candidate of discovered) {
      const targetPath = candidate.targetPath?.trim();
      if (!targetPath || !this.isSupportedWindowsAppTarget(targetPath)) {
        continue;
      }

      try {
        const info = await stat(targetPath);
        if (!info.isFile()) {
          continue;
        }
      } catch {
        continue;
      }

      if (this.isExcludedWindowsCandidate(candidate)) {
        continue;
      }

      const displayName = this.getPreferredDisplayName(candidate.name || targetPath, targetPath);
      const score = this.rankWindowsCandidate(candidate, displayName, targetPath);

      if (score < 25) {
        continue;
      }

      const dedupeKey = `${displayName.toLowerCase()}::${targetPath.toLowerCase()}`;
      const current = ranked.get(dedupeKey);

      if (current && current.score >= score) {
        continue;
      }

      ranked.set(dedupeKey, {
        score,
        entry: {
          id: uuidv4(),
          name: displayName,
          icon: "",
          executablePath: targetPath,
          args: this.parseArguments(candidate.arguments),
          workingDirectory: candidate.workingDirectory?.trim() || path.win32.dirname(targetPath),
          category: this.inferCategory(displayName, targetPath),
          sortOrder: 0,
          platform: "windows",
        },
      });
    }

    return Array.from(ranked.values())
      .sort((left, right) => right.score - left.score || left.entry.name.localeCompare(right.entry.name))
      .slice(0, MAX_SCAN_RESULTS)
      .map((item, index) => ({
        ...item.entry,
        sortOrder: index,
      }));
  }

  private async scanWindowsDiscoveryCandidates(): Promise<WindowsDiscoveryCandidate[]> {
    const script = `
$ErrorActionPreference = "Stop"
$shell = New-Object -ComObject WScript.Shell
$locations = @(
  [Environment]::GetFolderPath("Desktop"),
  [Environment]::GetFolderPath("CommonDesktopDirectory"),
  [Environment]::GetFolderPath("StartMenu"),
  [Environment]::GetFolderPath("CommonStartMenu")
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique

$results = New-Object System.Collections.Generic.List[object]

foreach ($location in $locations) {
  Get-ChildItem -Path $location -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object {
    $extension = $_.Extension.ToLowerInvariant()

    if ($extension -eq ".lnk") {
      try {
        $shortcut = $shell.CreateShortcut($_.FullName)
        if ([string]::IsNullOrWhiteSpace($shortcut.TargetPath)) { return }

        $results.Add([PSCustomObject]@{
          name = [System.IO.Path]::GetFileNameWithoutExtension($_.Name)
          targetPath = $shortcut.TargetPath
          arguments = $shortcut.Arguments
          workingDirectory = $shortcut.WorkingDirectory
          sourcePath = $_.FullName
        })
      } catch {
        return
      }

      return
    }

    if ($extension -eq ".exe") {
      $results.Add([PSCustomObject]@{
        name = [System.IO.Path]::GetFileNameWithoutExtension($_.Name)
        targetPath = $_.FullName
        arguments = ""
        workingDirectory = $_.DirectoryName
        sourcePath = $_.FullName
      })
    }
  }
}

$results | ConvertTo-Json -Compress
`.trim();

    const parsed = await this.execPowerShellJson<WindowsDiscoveryCandidate | WindowsDiscoveryCandidate[]>(script);
    if (!parsed) {
      return [];
    }

    return Array.isArray(parsed) ? parsed : [parsed];
  }

  private rankWindowsCandidate(
    candidate: WindowsDiscoveryCandidate,
    displayName: string,
    targetPath: string,
  ): number {
    const source = `${candidate.sourcePath ?? ""} ${displayName} ${targetPath}`.toLowerCase();
    let score = 0;

    if (source.includes("\\desktop") || source.includes("/desktop")) {
      score += 80;
    }

    if (source.includes("start menu")) {
      score += 45;
    }

    if (targetPath.toLowerCase().includes("program files")) {
      score += 24;
    }

    if (targetPath.toLowerCase().includes("appdata\\local")) {
      score += 18;
    }

    if (targetPath.toLowerCase().includes("windows\\system32")) {
      score -= 100;
    }

    if (targetPath.toLowerCase().includes("windowsapps")) {
      score -= 20;
    }

    for (const keyword of WINDOWS_PRIORITY_KEYWORDS) {
      if (source.includes(keyword)) {
        score += 70;
      }
    }

    if (displayName.length >= 3 && displayName.length <= 42) {
      score += 10;
    }

    if (candidate.arguments?.trim()) {
      score += 4;
    }

    return score;
  }

  private isExcludedWindowsCandidate(candidate: WindowsDiscoveryCandidate): boolean {
    const haystack = `${candidate.name ?? ""} ${candidate.targetPath ?? ""} ${candidate.sourcePath ?? ""}`.toLowerCase();
    return WINDOWS_EXCLUDED_KEYWORDS.some((keyword) => haystack.includes(keyword));
  }

  private isSupportedWindowsAppTarget(targetPath: string): boolean {
    const extension = path.win32.extname(targetPath).toLowerCase();
    return WINDOWS_APP_EXTENSIONS.has(extension);
  }

  private async pickWindowsExecutable(): Promise<string> {
    const script = `
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = "Select an application to add to PhoneDesk"
$dialog.Filter = "Applications (*.exe;*.bat;*.cmd;*.com)|*.exe;*.bat;*.cmd;*.com|All files (*.*)|*.*"
$dialog.Multiselect = $false
$dialog.CheckFileExists = $true
$dialog.RestoreDirectory = $true

$result = $dialog.ShowDialog()
if ($result -ne [System.Windows.Forms.DialogResult]::OK) {
  exit ${WINDOWS_PICKER_EXIT_CANCELLED}
}

[PSCustomObject]@{ path = $dialog.FileName } | ConvertTo-Json -Compress
`.trim();

    try {
      const parsed = await this.execPowerShellJson<{ path?: string }>(script);
      const selectedPath = parsed?.path?.trim();

      if (!selectedPath) {
        throw new AppError("No executable was selected", 400, "APP_PICKER_EMPTY_SELECTION");
      }

      return selectedPath;
    } catch (error) {
      if (this.isExecCancelled(error)) {
        throw new AppError("Selection cancelled", 400, "APP_PICKER_CANCELLED");
      }

      throw error;
    }
  }

  private async pickLinuxExecutable(): Promise<string> {
    if (await this.commandExists("zenity")) {
      try {
        const result = await this.execFileAsync("zenity", [
          "--file-selection",
          "--title=Select an application to add to PhoneDesk",
        ]);

        const selectedPath = result.stdout.trim();
        if (!selectedPath) {
          throw new AppError("No executable was selected", 400, "APP_PICKER_EMPTY_SELECTION");
        }

        return selectedPath;
      } catch (error) {
        if (this.isExecCancelled(error)) {
          throw new AppError("Selection cancelled", 400, "APP_PICKER_CANCELLED");
        }

        throw error;
      }
    }

    if (await this.commandExists("kdialog")) {
      try {
        const result = await this.execFileAsync("kdialog", [
          "--getopenfilename",
          homedir(),
          "*",
          "Select an application to add to PhoneDesk",
        ]);

        const selectedPath = result.stdout.trim();
        if (!selectedPath) {
          throw new AppError("No executable was selected", 400, "APP_PICKER_EMPTY_SELECTION");
        }

        return selectedPath;
      } catch (error) {
        if (this.isExecCancelled(error)) {
          throw new AppError("Selection cancelled", 400, "APP_PICKER_CANCELLED");
        }

        throw error;
      }
    }

    throw new AppError(
      "No supported desktop file picker was found. Install zenity or kdialog, or use advanced manual entry.",
      503,
      "APP_PICKER_UNAVAILABLE",
    );
  }

  private buildDraftFromExecutable(executablePath: string): CreateAppInput {
    const normalizedPath = executablePath.trim();
    const executableBase = path.parse(normalizedPath).name;
    const displayName = this.getPreferredDisplayName(executableBase, normalizedPath);

    return {
      name: displayName,
      icon: "",
      executablePath: normalizedPath,
      workingDirectory: path.dirname(normalizedPath),
      category: this.inferCategory(displayName, normalizedPath),
      platform: this.platform,
    };
  }

  private getPreferredDisplayName(nameOrPath: string, executablePath?: string): string {
    const rawBaseName = executablePath
      ? path.parse(path.basename(executablePath)).name
      : path.parse(path.basename(nameOrPath)).name || nameOrPath;

    const fromMap = DISPLAY_NAME_BY_EXECUTABLE[rawBaseName.toLowerCase()];
    if (fromMap) {
      return fromMap;
    }

    const candidate = path.parse(path.basename(nameOrPath)).name || nameOrPath;
    return candidate
      .replace(/[._-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, (token) => token.toUpperCase());
  }

  private inferCategory(name: string, executablePath: string): string | undefined {
    const haystack = `${name} ${executablePath}`.toLowerCase();

    if (/(chrome|firefox|edge|brave|opera|browser)/.test(haystack)) {
      return "Browser";
    }

    if (/(visual studio|code|pycharm|intellij|webstorm|datagrip|rider|docker|postman|terminal|git)/.test(haystack)) {
      return "Development";
    }

    if (/(discord|telegram|slack|teams|zoom|skype)/.test(haystack)) {
      return "Communication";
    }

    if (/(spotify|vlc|obs|music|video|netflix|media|photoshop|premiere|blender)/.test(haystack)) {
      return "Media";
    }

    if (/(steam|epic|battle.net|riot|game|unity|unreal)/.test(haystack)) {
      return "Gaming";
    }

    if (/(word|excel|powerpoint|onenote|office|notepad|acrobat)/.test(haystack)) {
      return "Productivity";
    }

    return undefined;
  }

  private parseArguments(argsLine?: string): string[] | undefined {
    if (!argsLine?.trim()) {
      return undefined;
    }

    const tokens = this.tokenizeCommand(argsLine);
    return tokens.length > 0 ? tokens : undefined;
  }

  private async scanLinuxApps(): Promise<AppEntry[]> {
    const binaryRoots = [
      "/usr/bin",
      "/usr/local/bin",
      "/snap/bin",
      "/var/lib/flatpak/exports/bin",
      this.resolveHomePath("~/.local/share/flatpak/exports/bin"),
    ];
    const desktopRoots = [
      "/usr/share/applications",
      this.resolveHomePath("~/.local/share/applications"),
      "/var/lib/flatpak/exports/share/applications",
      ...(await this.getSnapDesktopRoots()),
    ];
    const seen = new Set<string>();
    const candidates: AppEntry[] = [];

    const addCandidate = (name: string, executablePath: string, icon: string): void => {
      if (candidates.length >= MAX_SCAN_RESULTS) {
        return;
      }

      const normalizedName = name.trim();
      const normalizedPath = executablePath.trim();

      if (!normalizedName || !normalizedPath || seen.has(normalizedPath)) {
        return;
      }

      seen.add(normalizedPath);
      candidates.push({
        id: uuidv4(),
        name: this.getPreferredDisplayName(normalizedName, normalizedPath),
        icon,
        executablePath: normalizedPath,
        category: this.inferCategory(normalizedName, normalizedPath),
        sortOrder: candidates.length,
        platform: "linux",
      });
    };

    for (const root of desktopRoots) {
      if (candidates.length >= MAX_SCAN_RESULTS) {
        break;
      }

      try {
        await access(root, constants.R_OK);
      } catch {
        continue;
      }

      let entries: string[];
      try {
        entries = await readdir(root);
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (candidates.length >= MAX_SCAN_RESULTS || !entry.endsWith(".desktop")) {
          continue;
        }

        const desktopFilePath = path.join(root, entry);
        const desktopEntry = await this.parseDesktopEntry(desktopFilePath);

        if (!desktopEntry) {
          continue;
        }

        const resolvedPath = await this.resolveLinuxExecutablePath(desktopEntry.executablePath, binaryRoots);
        addCandidate(desktopEntry.name, resolvedPath, desktopEntry.icon);
      }
    }

    if (candidates.length >= MAX_SCAN_RESULTS) {
      return candidates;
    }

    for (const root of binaryRoots) {
      try {
        await access(root, constants.R_OK);
      } catch {
        continue;
      }

      let entries: string[];
      try {
        entries = await readdir(root);
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (candidates.length >= MAX_SCAN_RESULTS) {
          break;
        }

        const executablePath = path.join(root, entry);

        if (seen.has(executablePath)) {
          continue;
        }

        try {
          const info = await stat(executablePath);
          const executable = info.isFile() && (info.mode & 0o111) !== 0;

          if (!executable) {
            continue;
          }

          addCandidate(entry, executablePath, "");
        } catch {
          continue;
        }
      }
    }

    return candidates;
  }

  private resolveHomePath(value: string): string {
    if (!value.startsWith("~/")) {
      return value;
    }

    return path.join(homedir(), value.slice(2));
  }

  private async getSnapDesktopRoots(): Promise<string[]> {
    const snapRoot = "/snap";

    try {
      await access(snapRoot, constants.R_OK);
    } catch {
      return [];
    }

    let snapPackages: string[];
    try {
      snapPackages = await readdir(snapRoot);
    } catch {
      return [];
    }

    const roots: string[] = [];

    for (const packageName of snapPackages) {
      const guiPath = path.join(snapRoot, packageName, "current", "meta", "gui");

      try {
        const info = await stat(guiPath);
        if (info.isDirectory()) {
          roots.push(guiPath);
        }
      } catch {
        continue;
      }
    }

    return roots;
  }

  private async parseDesktopEntry(desktopFilePath: string): Promise<LinuxDesktopEntry | null> {
    let fileContent: string;
    try {
      fileContent = await readFile(desktopFilePath, "utf-8");
    } catch {
      return null;
    }

    let inDesktopSection = false;
    let name: string | null = null;
    let exec: string | null = null;
    let icon = "";
    let hidden = false;
    let noDisplay = false;
    let terminal = false;

    for (const line of fileContent.split(/\r?\n/)) {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
        inDesktopSection = trimmed === "[Desktop Entry]";
        continue;
      }

      if (!inDesktopSection) {
        continue;
      }

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) {
        continue;
      }

      const key = trimmed.slice(0, separatorIndex);
      const value = trimmed.slice(separatorIndex + 1).trim();

      if (key === "Name" && !name) {
        name = value;
        continue;
      }

      if (key === "Exec") {
        exec = value;
        continue;
      }

      if (key === "Icon") {
        icon = value;
        continue;
      }

      if (key === "Hidden") {
        hidden = value.toLowerCase() === "true";
        continue;
      }

      if (key === "NoDisplay") {
        noDisplay = value.toLowerCase() === "true";
        continue;
      }

      if (key === "Terminal") {
        terminal = value.toLowerCase() === "true";
      }
    }

    if (hidden || noDisplay || terminal || !name || !exec) {
      return null;
    }

    const executablePath = this.extractDesktopExecutable(exec);
    if (!executablePath) {
      return null;
    }

    return {
      name,
      executablePath,
      icon,
    };
  }

  private extractDesktopExecutable(exec: string): string | null {
    const sanitized = exec.replace(DESKTOP_EXEC_PLACEHOLDER_REGEX, "").trim();
    const tokens = this.tokenizeCommand(sanitized);

    if (tokens.length === 0) {
      return null;
    }

    let commandIndex = 0;

    if (tokens[0] === "env") {
      commandIndex = 1;

      while (commandIndex < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(tokens[commandIndex])) {
        commandIndex += 1;
      }

      while (commandIndex < tokens.length && tokens[commandIndex].startsWith("-")) {
        commandIndex += 1;
      }
    }

    const command = tokens[commandIndex];
    return command ? command.trim() : null;
  }

  private tokenizeCommand(command: string): string[] {
    const tokens: string[] = [];
    let current = "";
    let quote: "'" | '"' | null = null;
    let escaped = false;

    for (const char of command) {
      if (escaped) {
        current += char;
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (quote) {
        if (char === quote) {
          quote = null;
        } else {
          current += char;
        }
        continue;
      }

      if (char === '"' || char === "'") {
        quote = char;
        continue;
      }

      if (/\s/.test(char)) {
        if (current) {
          tokens.push(current);
          current = "";
        }
        continue;
      }

      current += char;
    }

    if (current) {
      tokens.push(current);
    }

    return tokens;
  }

  private async resolveLinuxExecutablePath(command: string, binaryRoots: string[]): Promise<string> {
    const normalized = command.trim();

    if (!normalized) {
      return normalized;
    }

    if (path.isAbsolute(normalized)) {
      const executableName = path.basename(normalized);

      for (const root of binaryRoots) {
        const candidatePath = path.join(root, executableName);

        try {
          const info = await stat(candidatePath);
          if (info.isFile() && (info.mode & 0o111) !== 0) {
            return candidatePath;
          }
        } catch {
          continue;
        }
      }

      return normalized;
    }

    for (const root of binaryRoots) {
      const candidatePath = path.join(root, normalized);

      try {
        const info = await stat(candidatePath);
        if (info.isFile() && (info.mode & 0o111) !== 0) {
          return candidatePath;
        }
      } catch {
        continue;
      }
    }

    return normalized;
  }

  private async withResolvedIcons(entries: AppEntry[]): Promise<AppEntry[]> {
    if (this.platform !== "linux") {
      return entries;
    }

    return Promise.all(
      entries.map(async (entry) => ({
        ...entry,
        icon: await this.resolveLinuxAppIcon(entry),
      })),
    );
  }

  private async persistLinuxIconsIfNeeded(entries: AppEntry[]): Promise<AppEntry[]> {
    if (this.persistedIconMigrationDone || entries.length === 0) {
      return entries;
    }

    this.persistedIconMigrationDone = true;
    let changed = false;

    const nextEntries = await Promise.all(
      entries.map(async (entry) => {
        const resolvedIcon = await this.resolveLinuxAppIcon(entry);

        if (resolvedIcon && resolvedIcon !== entry.icon) {
          changed = true;
          return { ...entry, icon: resolvedIcon };
        }

        return entry;
      }),
    );

    if (!changed) {
      return entries;
    }

    try {
      await this.repository.saveAll(nextEntries);
      return nextEntries;
    } catch (error) {
      this.logger.warn("Failed to persist refreshed Linux icons", {
        error: error instanceof Error ? error.message : "unknown",
      });
      return entries;
    }
  }

  private async resolveLinuxAppIcon(app: Pick<AppEntry, "name" | "icon" | "executablePath">): Promise<string> {
    const currentIcon = app.icon.trim();

    if (this.isAlreadyRenderableIcon(currentIcon)) {
      return currentIcon;
    }

    const cacheKey = `${currentIcon}|${app.executablePath}|${app.name}`.toLowerCase();
    const cached = this.resolvedIconCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const hints = this.collectIconHints(app);

    for (const hint of hints) {
      const iconPath = await this.resolveLinuxIconPath(hint);
      if (!iconPath) {
        continue;
      }

      const dataUrl = await this.convertIconFileToDataUrl(iconPath);
      if (!dataUrl) {
        continue;
      }

      this.resolvedIconCache.set(cacheKey, dataUrl);
      return dataUrl;
    }

    this.resolvedIconCache.set(cacheKey, currentIcon);
    return currentIcon;
  }

  private isAlreadyRenderableIcon(icon: string): boolean {
    if (!icon) {
      return false;
    }

    if (icon.startsWith("data:image") || icon.startsWith("http://") || icon.startsWith("https://")) {
      return true;
    }

    return icon.startsWith("/") && !icon.startsWith("/usr/") && !icon.startsWith("/home/");
  }

  private collectIconHints(app: Pick<AppEntry, "name" | "icon" | "executablePath">): string[] {
    const hints = new Set<string>();

    const addHint = (value: string | undefined): void => {
      const normalized = value?.trim();
      if (normalized) {
        hints.add(normalized);
      }
    };

    addHint(app.icon);
    addHint(app.executablePath);
    addHint(path.basename(app.executablePath));
    addHint(path.parse(path.basename(app.executablePath)).name);
    addHint(app.name);
    addHint(app.name.split(/\s+/)[0]);
    addHint(app.name.toLowerCase().replace(/\s+/g, "-"));
    addHint(app.name.toLowerCase().replace(/\s+/g, ""));

    return Array.from(hints);
  }

  private async resolveLinuxIconPath(iconHint: string): Promise<string | null> {
    const trimmed = iconHint.trim();
    if (!trimmed) {
      return null;
    }

    if (path.isAbsolute(trimmed)) {
      return this.resolveAbsoluteIconPath(trimmed);
    }

    const normalizedName = path.parse(path.basename(trimmed)).name.toLowerCase();
    if (!normalizedName) {
      return null;
    }

    const iconIndex = await this.getLinuxIconIndex();
    const directMatch = iconIndex.get(normalizedName);
    if (directMatch) {
      return directMatch;
    }

    const fallbackNames = new Set<string>([normalizedName.replace(/-symbolic$/, "")]);
    if (normalizedName.includes(".")) {
      fallbackNames.add(normalizedName.split(".").at(-1) ?? "");
    }
    if (normalizedName.includes("-")) {
      fallbackNames.add(normalizedName.split("-").at(-1) ?? "");
    }

    for (const fallback of fallbackNames) {
      const match = iconIndex.get(fallback.trim());
      if (match) {
        return match;
      }
    }

    return null;
  }

  private async resolveAbsoluteIconPath(iconPath: string): Promise<string | null> {
    const extension = path.extname(iconPath).toLowerCase();

    if (this.isSupportedIconExtension(extension)) {
      try {
        const info = await stat(iconPath);
        if (info.isFile()) {
          return iconPath;
        }
      } catch {
        // Ignore and continue with extension fallbacks.
      }
    }

    if (extension) {
      return null;
    }

    for (const iconExtension of ICON_EXTENSIONS) {
      const candidatePath = `${iconPath}${iconExtension}`;

      try {
        const info = await stat(candidatePath);
        if (info.isFile()) {
          return candidatePath;
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  private async convertIconFileToDataUrl(iconPath: string): Promise<string | null> {
    const cached = this.iconDataUrlCache.get(iconPath);
    if (cached !== undefined) {
      return cached.length > 0 ? cached : null;
    }

    const extension = path.extname(iconPath).toLowerCase();

    if (!this.isSupportedIconExtension(extension)) {
      this.iconDataUrlCache.set(iconPath, "");
      return null;
    }

    try {
      const info = await stat(iconPath);
      if (!info.isFile() || info.size > MAX_ICON_SOURCE_BYTES) {
        this.iconDataUrlCache.set(iconPath, "");
        return null;
      }

      const fileBuffer = await readFile(iconPath);
      const dataUrl = `data:${ICON_MIME_TYPES[extension]};base64,${fileBuffer.toString("base64")}`;

      if (dataUrl.length > MAX_ICON_DATA_URL_LENGTH) {
        this.iconDataUrlCache.set(iconPath, "");
        return null;
      }

      this.iconDataUrlCache.set(iconPath, dataUrl);
      return dataUrl;
    } catch {
      this.iconDataUrlCache.set(iconPath, "");
      return null;
    }
  }

  private isSupportedIconExtension(extension: string): extension is (typeof ICON_EXTENSIONS)[number] {
    return (ICON_EXTENSIONS as readonly string[]).includes(extension);
  }

  private async getLinuxIconIndex(): Promise<Map<string, string>> {
    if (!this.linuxIconIndexPromise) {
      this.linuxIconIndexPromise = this.buildLinuxIconIndex();
    }

    return this.linuxIconIndexPromise;
  }

  private async buildLinuxIconIndex(): Promise<Map<string, string>> {
    const iconRoots = [
      this.resolveHomePath("~/.local/share/icons"),
      "/usr/share/icons",
      "/usr/local/share/icons",
      "/usr/share/pixmaps",
      "/var/lib/flatpak/exports/share/icons",
      this.resolveHomePath("~/.local/share/flatpak/exports/share/icons"),
    ];

    const index = new Map<string, IconIndexCandidate>();

    for (const root of iconRoots) {
      await this.indexIconsFromRoot(root, index);
    }

    return new Map(Array.from(index.entries(), ([name, candidate]) => [name, candidate.path]));
  }

  private async indexIconsFromRoot(root: string, index: Map<string, IconIndexCandidate>): Promise<void> {
    try {
      await access(root, constants.R_OK);
    } catch {
      return;
    }

    const queue: Array<{ directory: string; depth: number }> = [{ directory: root, depth: 0 }];
    let processedDirectories = 0;

    while (queue.length > 0 && processedDirectories < ICON_INDEX_MAX_DIRECTORIES) {
      const current = queue.shift();
      if (!current) {
        break;
      }

      processedDirectories += 1;

      let entries: Dirent[];
      try {
        entries = await readdir(current.directory, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        const entryPath = path.join(current.directory, entry.name);

        if (entry.isDirectory()) {
          if (current.depth < ICON_INDEX_MAX_DEPTH && !entry.name.startsWith(".")) {
            queue.push({ directory: entryPath, depth: current.depth + 1 });
          }
          continue;
        }

        if (entry.isFile() || entry.isSymbolicLink()) {
          await this.indexIconFile(entryPath, index);
        }
      }
    }
  }

  private async indexIconFile(iconPath: string, index: Map<string, IconIndexCandidate>): Promise<void> {
    const extension = path.extname(iconPath).toLowerCase();
    if (!this.isSupportedIconExtension(extension)) {
      return;
    }

    let info: Stats;
    try {
      info = await stat(iconPath);
    } catch {
      return;
    }

    if (!info.isFile() || info.size > MAX_ICON_SOURCE_BYTES) {
      return;
    }

    const baseName = path.basename(iconPath, extension).toLowerCase();
    if (!baseName) {
      return;
    }

    const aliases = this.buildIconAliases(baseName);
    const score = this.scoreIconPath(iconPath, extension);

    for (const alias of aliases) {
      const current = index.get(alias);
      if (!current || score > current.score) {
        index.set(alias, { path: iconPath, score });
      }
    }
  }

  private buildIconAliases(baseName: string): Set<string> {
    const aliases = new Set<string>();
    const normalized = baseName.trim().toLowerCase();

    if (!normalized) {
      return aliases;
    }

    aliases.add(normalized);
    aliases.add(normalized.replace(/-symbolic$/, ""));

    if (normalized.includes(".")) {
      aliases.add(normalized.split(".").at(-1) ?? normalized);
    }

    if (normalized.includes("-")) {
      aliases.add(normalized.split("-").at(-1) ?? normalized);
    }

    return aliases;
  }

  private scoreIconPath(iconPath: string, extension: string): number {
    const lower = iconPath.toLowerCase();
    const extensionScores: Record<string, number> = {
      ".png": 60,
      ".svg": 55,
      ".webp": 50,
      ".jpg": 45,
      ".jpeg": 45,
      ".xpm": 35,
    };

    let score = extensionScores[extension] ?? 0;

    if (lower.includes("/apps/")) {
      score += 20;
    }
    if (lower.includes("/pixmaps/")) {
      score += 16;
    }
    if (lower.includes("/hicolor/")) {
      score += 12;
    }
    if (lower.includes("/scalable/")) {
      score += 10;
    }
    if (lower.includes("symbolic")) {
      score -= 20;
    }

    const sizePairMatch = lower.match(/\/(\d{2,4})x(\d{2,4})\//);
    if (sizePairMatch) {
      const parsed = Number.parseInt(sizePairMatch[1], 10);
      if (Number.isFinite(parsed)) {
        score += Math.min(parsed, 512) / 2;
      }
    }

    return score;
  }

  private async walkDirectory(
    root: string,
    depth: number,
    maxDepth: number,
    onFile: (entryPath: string) => Promise<void>,
  ): Promise<void> {
    if (depth > maxDepth) {
      return;
    }

    let entries: string[];
    try {
      entries = await readdir(root);
    } catch {
      return;
    }

    for (const entry of entries) {
      const entryPath = path.join(root, entry);

      try {
        const info = await stat(entryPath);

        if (info.isDirectory()) {
          await this.walkDirectory(entryPath, depth + 1, maxDepth, onFile);
          continue;
        }

        if (info.isFile()) {
          await onFile(entryPath);
        }
      } catch {
        continue;
      }
    }
  }

  private async commandExists(command: string): Promise<boolean> {
    try {
      await this.execFileAsync("which", [command]);
      return true;
    } catch {
      return false;
    }
  }

  private async execPowerShellJson<T>(script: string): Promise<T> {
    const result = await this.execFileAsync(
      "powershell",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
    );

    const output = result.stdout.trim();
    if (!output) {
      throw new AppError("The system command did not return any output", 500, "SYSTEM_COMMAND_EMPTY_OUTPUT");
    }

    try {
      return JSON.parse(output) as T;
    } catch (error) {
      this.logger.warn("Failed to parse PowerShell JSON output", {
        output,
        stderr: result.stderr.trim() || undefined,
        error: error instanceof Error ? error.message : "unknown",
      });
      throw new AppError("Failed to read PowerShell output", 500, "POWERSHELL_OUTPUT_INVALID");
    }
  }

  private execFileAsync(
    command: string,
    args: string[],
    options: { shell?: boolean; windowsHide?: boolean; maxBuffer?: number } = {},
  ): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
      execFile(command, args, options, (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }

        resolve({ stdout, stderr });
      });
    });
  }

  private isExecCancelled(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    const code = (error as { code?: unknown }).code;
    return code === WINDOWS_PICKER_EXIT_CANCELLED || code === 1;
  }
}
