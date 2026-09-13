const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { parseProject, resolveFile } = require('./project-parser');

function coloredIcon(icon, color) {
  return new vscode.ThemeIcon(icon, new vscode.ThemeColor(color));
}
function findIncludes(file, includePaths, visited = new Set()) {
  const normalized = path.normalize(file).toLowerCase();
  if (visited.has(normalized) || !fs.existsSync(file)) return [];
  visited.add(normalized);
  let source;
  try { source = fs.readFileSync(file, 'utf8'); } catch (_) { return []; }
  const result = [];
  const base = path.dirname(file);
  const roots = [base].concat(includePaths || []);
  for (const match of source.matchAll(/^\s*#\s*include\s*[<"]([^>"]+)[>"]/gm)) {
    const name = match[1].trim();
    const found = roots.map(root => path.resolve(root, name)).find(candidate => fs.existsSync(candidate));
    if (found && !visited.has(path.normalize(found).toLowerCase())) result.push(found);
  }
  return result;
}

class ProjectItem extends vscode.TreeItem {
  constructor(label, collapsibleState, kind, data) {
    super(label, collapsibleState); this.kind = kind; this.data = data;
    if (kind === 'project') { this.contextValue = 'c251ProjectRoot'; this.iconPath = coloredIcon('project', 'terminal.ansiCyan'); }
    if (kind === 'file' || kind === 'include') {
      this.contextValue = kind === 'file' ? 'c251File' : 'c251Include';
      const ext = path.extname(label).toLowerCase();
      const icon = ext === '.c' ? 'file-code' : ext === '.h' || ext === '.hpp' || ext === '.inc' ? 'file-text' :
        ext === '.a51' || ext === '.asm' || ext === '.a251' ? 'symbol-method' : ext === '.lib' || ext === '.a' ? 'archive' : 'file';
      const color = ext === '.c' ? 'charts.blue' : ext === '.h' || ext === '.hpp' || ext === '.inc' ? 'charts.green' :
        ext === '.a51' || ext === '.asm' || ext === '.a251' ? 'charts.purple' : ext === '.lib' || ext === '.a' ? 'charts.yellow' : 'foreground';
      this.iconPath = coloredIcon(icon, color);
      const filePath = typeof data === 'string' ? data : data.path;
      this.command = { command: 'vscode.open', title: 'Open', arguments: [vscode.Uri.file(filePath)] };
    }
    if (kind === 'target') { this.contextValue = 'c251Target'; this.iconPath = coloredIcon('symbol-class', 'charts.purple'); }
    if (kind === 'group') {
      this.contextValue = 'c251Group';
      const icons = {
        doc: ['book', 'charts.yellow'],
        zf_common: ['package', 'charts.green'],
        zf_driver: ['tools', 'charts.blue'],
        zf_device: ['circuit-board', 'charts.purple'],
        zf_components: ['extensions', 'charts.orange'],
        code: ['code', 'terminal.ansiCyan'],
        user: ['account', 'charts.red']
      };
      const [groupIcon, groupColor] = icons[label] || ['folder', 'foreground'];
      this.iconPath = coloredIcon(groupIcon, groupColor);
    }
  }
}
class ProjectProvider {
  constructor() {
    this.changed = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.changed.event;
    this.projects = [];
    this.activeProjectFile = undefined;
  }
  get project() { return this.projects[0]; }
  setProjects(projects) {
    const previousTargets = new Map(this.projects.map(project => [path.normalize(project.file), project.activeTargetIndex]));
    this.projects = projects || [];
    this.projects.forEach(project => {
      const previousIndex = previousTargets.get(path.normalize(project.file));
      project.activeTargetIndex = Number.isInteger(previousIndex) && previousIndex < project.targets.length ? previousIndex : 0;
    });
    if (!this.activeProjectFile || !this.projects.some(project => project.file === this.activeProjectFile)) {
      this.activeProjectFile = this.projects[0] && this.projects[0].file;
    }
    this.changed.fire();
  }
  addProject(project) {
    const index = this.projects.findIndex(item => path.normalize(item.file) === path.normalize(project.file));
    if (index >= 0) this.projects[index] = project;
    else this.projects.push(project);
    project.activeTargetIndex = 0;
    this.activeProjectFile = project.file;
    this.changed.fire();
  }
  getTreeItem(e) { return e; }
  getChildren(e) {
    if (!this.projects.length) return [new ProjectItem('Open a .uvproj/.uvprojx project', vscode.TreeItemCollapsibleState.None, 'hint')];
    if (!e) {
      const names = new Map();
      for (const project of this.projects) {
        const base = project.name.replace(/\.uvprojx?$/i, '');
        names.set(base, (names.get(base) || 0) + 1);
      }
      return this.projects.map(project => {
        const base = project.name.replace(/\.uvprojx?$/i, '');
        const duplicate = names.get(base) > 1;
        const workspace = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0].uri.fsPath;
        const relative = workspace ? path.relative(workspace, path.dirname(project.file)) : path.dirname(project.file);
        return new ProjectItem(duplicate && relative ? `${base}  [${relative}]` : base, vscode.TreeItemCollapsibleState.Expanded, 'project', project);
      });
    }
    if (e.kind === 'project') {
      const project = e.data;
      return project.targets.map((target, index) => new ProjectItem(
        `${target.name}${index === project.activeTargetIndex ? ' (active)' : ''}`,
        vscode.TreeItemCollapsibleState.Collapsed,
        'target',
        { project, index }
      ));
    }
    if (e.kind === 'target') {
      const project = e.data.project;
      const target = project.targets[e.data.index];
      const includePaths = (target && target.includePaths || []).map(item => path.resolve(path.dirname(project.file), item));
      return (target ? target.groups : []).map(group => new ProjectItem(group.name, vscode.TreeItemCollapsibleState.Collapsed, 'group', { project, group, includePaths }));
    }
    if (e.kind === 'group') {
      const { project, group, includePaths } = e.data;
      return group.files.map(file => {
        const filePath = resolveFile(project.file, file.path, file.name);
        const refs = findIncludes(filePath, includePaths);
        return new ProjectItem(file.name, refs.length ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None, 'file', { path: filePath, project, includePaths, depth: 0 });
      });
    }
    if (e.kind === 'file') {
      if (e.data.depth >= 12) return [];
      const refs = findIncludes(e.data.path, e.data.includePaths);
      return refs.map(file => new ProjectItem(path.basename(file), vscode.TreeItemCollapsibleState.Collapsed, 'include', { path: file, project: e.data.project, includePaths: e.data.includePaths, depth: e.data.depth + 1 }));
    }
    if (e.kind === 'include') {
      if (e.data.depth >= 12) return [];
      const refs = findIncludes(e.data.path, e.data.includePaths);
      return refs.map(file => new ProjectItem(path.basename(file), vscode.TreeItemCollapsibleState.Collapsed, 'include', { path: file, project: e.data.project, includePaths: e.data.includePaths, depth: e.data.depth + 1 }));
    }
    return [];
  }
}

async function pickProject() {
  const uri = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { 'Keil C251 project': ['uvprojx', 'uvproj'] }, openLabel: 'Open Project' });
  return uri && uri[0] && uri[0].fsPath;
}
function discoverProjects() {
  const folders = vscode.workspace.workspaceFolders || [];
  if (!folders.length) return [];
  const excluded = vscode.workspace.getConfiguration('KeilAssistant').get('Project.ExcludeList', []);
  const files = [];
  function walk(dir, depth) {
    if (depth > 8) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'out_file' || /^(example|examples|template|templates)$/i.test(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (/\.uvprojx?$/i.test(entry.name) && !excluded.includes(entry.name)) files.push(full);
    }
  }
  walk(folders[0].uri.fsPath, 0);
  files.sort((a, b) => {
    const score = p => /[\\/]project[\\/]mdk[\\/]/i.test(p) ? 0 : /[\\/]mdk[\\/]/i.test(p) ? 1 : 2;
    return score(a) - score(b) || a.length - b.length;
  });
  return files;
}
function discoverProject() { return discoverProjects()[0]; }
function updateCppProperties(project) {
  const vscodeDir = path.join(path.dirname(project.file), '.vscode');
  const file = path.join(vscodeDir, 'c_cpp_properties.json');
  try {
    fs.mkdirSync(vscodeDir, { recursive: true });
    let config = { configurations: [], version: 4 };
    if (fs.existsSync(file)) {
      try { config = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { /* recreate malformed generated config */ }
    }
    if (!Array.isArray(config.configurations)) config.configurations = [];
    const builtins = ['__C251__', '__VSCODE_C251__', 'reentrant=', 'compact=', 'small=', 'large=', 'data=', 'idata=', 'pdata=', 'bdata=', 'xdata=', 'code=', 'bit=char', 'sbit=char', 'sfr=char', 'sfr16=int', 'sfr32=int', 'interrupt=', 'using=', '_at_=', '_priority_=', '_task_='];
    for (const target of project.targets) {
      const includePath = [...target.includePaths.map(item => path.resolve(path.dirname(project.file), item)), path.dirname(project.file)];
      const defines = [...new Set(builtins.concat(target.defines || []))];
      const next = { name: `C251: ${target.name}`, includePath, defines, intelliSenseMode: '${default}', cStandard: 'c11' };
      const index = config.configurations.findIndex(item => item.name === next.name);
      if (index >= 0) config.configurations[index] = { ...config.configurations[index], ...next };
      else config.configurations.push(next);
    }
    fs.writeFileSync(file, JSON.stringify(config, null, 4));
  } catch (error) {
    vscode.window.showWarningMessage(`Could not update c_cpp_properties.json: ${error.message}`);
  }
}
function uv4Path() {
  const configured = vscode.workspace.getConfiguration('KeilAssistant').get('C251.Uv4Path', '');
  if (configured) return configured;
  const guesses = ['C:\\\\Keil_v5\\\\UV4\\\\UV4.exe', 'C:\\\\Keil_v5\\\\UV4.exe', 'C:\\\\Keil\\\\UV4\\\\UV4.exe'];
  return guesses.find(fs.existsSync);
}
function findBuildStatus(project, minimumTime, previousMtime) {
  const root = path.dirname(project);
  const logs = [];
  function walk(dir, depth) {
    if (depth > 3) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (/\.build_log\.htm$/i.test(entry.name)) logs.push(full);
    }
  }
  try { walk(root, 0); } catch (_) { return undefined; }
  const log = logs.map(file => ({ file, time: fs.statSync(file).mtimeMs }))
    .filter(item => (!minimumTime || item.time >= minimumTime - 5000) && (!previousMtime || item.time > previousMtime))
    .sort((a, b) => b.time - a.time)[0];
  if (!log) return undefined;
  const content = fs.readFileSync(log.file, 'utf8').replace(/<[^>]+>/g, ' ');
  const match = content.match(/-\s*(\d+)\s+Error\(s\),\s*(\d+)\s+Warning\(s\)/i);
  return match ? { errors: Number(match[1]), warnings: Number(match[2]), file: log.file } : undefined;
}
function findBuildLog(project, minimumTime, previousMtime) {
  const root = path.dirname(project);
  const logs = [];
  function walk(dir, depth) {
    if (depth > 3) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (/\.build_log\.htm$/i.test(entry.name)) logs.push({ file: full, time: fs.statSync(full).mtimeMs });
    }
  }
  try { walk(root, 0); } catch (_) { return undefined; }
  const item = logs.filter(log => (!minimumTime || log.time >= minimumTime - 5000) && (!previousMtime || log.time > previousMtime)).sort((a, b) => b.time - a.time)[0];
  return item && item.file;
}
function readBuildLog(file) {
  if (!file) return [];
  let content = fs.readFileSync(file, 'utf8');
  const pre = content.match(/<pre>([\s\S]*?)<\/pre>/i);
  content = pre ? pre[1] : content;
  content = content.replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return content.trim().split(/\r?\n/);
}
function clearC251Diagnostics() {
  if (vscode.languages && clearC251Diagnostics.collection) clearC251Diagnostics.collection.clear();
}
function updateC251Diagnostics(lines, project) {
  if (!vscode.languages) return;
  if (!clearC251Diagnostics.collection) clearC251Diagnostics.collection = vscode.languages.createDiagnosticCollection('c251');
  const diagnostics = new Map();
  for (const line of lines) {
    const match = line.match(/^(.+?)\((\d+)(?:,\d+)?\):\s*(warning|error)\s+([A-Z0-9-]+):?\s*(.*)$/i);
    if (!match) continue;
    const file = path.resolve(path.dirname(project), match[1].trim());
    const uri = vscode.Uri.file(file);
    const range = new vscode.Range(Number(match[2]) - 1, 0, Number(match[2]) - 1, 1000);
    const severity = match[3].toLowerCase() === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning;
    const diagnostic = new vscode.Diagnostic(range, `${match[4]}: ${match[5]}`, severity);
    diagnostic.code = match[4];
    if (!diagnostics.has(uri.toString())) diagnostics.set(uri.toString(), { uri, entries: [] });
    diagnostics.get(uri.toString()).entries.push(diagnostic);
  }
  for (const item of diagnostics.values()) clearC251Diagnostics.collection.set(item.uri, item.entries);
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function waitForBuildStatus(project, minimumTime, previousMtime, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = findBuildStatus(project, minimumTime, previousMtime);
    if (status) return status;
    await sleep(200);
  }
  return undefined;
}
async function runUv4(project, target, action) {
  const exe = uv4Path();
  if (!exe) { vscode.window.showErrorMessage('Set KeilAssistant.C251.Uv4Path to your C251 UV4.exe path.'); return; }
  const output = vscode.window.createOutputChannel('Keil C251'); output.show(true);
  output.clear();
  const flag = action === 'build' ? '-b' : action === 'rebuild' ? '-r' : '-f';
  const startedAt = Date.now();
  const previousLog = findBuildLog(project);
  const previousLogMtime = previousLog && fs.statSync(previousLog).mtimeMs;
  output.appendLine(`> "${exe}" ${flag} "${project}" -j0 -t "${target}"`);
  output.appendLine(`Starting C251 ${action} for target '${target}'...`);
  clearC251Diagnostics();
  await new Promise(resolve => {
    let logFile;
    let streamedLines = 0;
    let progressSeconds = 0;
    const progressTimer = setInterval(() => {
      progressSeconds += 1;
      output.appendLine(`[C251] ${action} in progress... ${progressSeconds}s`);
    }, 1000);
    const streamTimer = setInterval(() => {
      try {
        logFile = findBuildLog(project, startedAt, previousLogMtime) || logFile;
        const lines = readBuildLog(logFile);
        while (streamedLines < lines.length) output.appendLine(lines[streamedLines++]);
      } catch (_) { /* UV4 may hold the log while it is rewriting it. */ }
    }, 250);
    const child = cp.spawn(exe, [flag, project, '-j0', '-t', target], { cwd: path.dirname(project), windowsHide: true });
    child.stdout.on('data', d => output.append(d.toString())); child.stderr.on('data', d => output.append(d.toString()));
    child.on('error', e => { clearInterval(streamTimer); clearInterval(progressTimer); output.appendLine(e.message); vscode.window.showErrorMessage(`Unable to start UV4.exe: ${e.message}`); resolve(); });
    child.on('close', async code => {
      clearInterval(streamTimer);
      clearInterval(progressTimer);
      const status = await waitForBuildStatus(project, startedAt, previousLogMtime);
      logFile = (status && status.file) || findBuildLog(project, startedAt, previousLogMtime) || logFile;
      const remaining = readBuildLog(logFile).slice(streamedLines);
      for (const line of remaining) { output.appendLine(line); await sleep(12); }
      updateC251Diagnostics(readBuildLog(logFile), project);
      output.appendLine(`\nUV4 exited with code ${code}`);
      if (status) output.appendLine(`Keil build log: ${status.errors} error(s), ${status.warnings} warning(s)`);
      if (code === 0 || (status && status.errors === 0)) {
        vscode.window.showInformationMessage(`C251 ${action} completed${status && status.warnings ? ` with ${status.warnings} warning(s)` : ''}`);
      } else {
        vscode.window.showErrorMessage(`C251 ${action} failed (${code})`);
      }
      resolve();
    });
  });
}

function activate(context) {
  const provider = new ProjectProvider(); vscode.window.registerTreeDataProvider('c251Project', provider);
  function refreshProjects() {
    const files = new Set(discoverProjects());
    provider.projects.forEach(project => {
      if (fs.existsSync(project.file)) files.add(project.file);
    });
    const projects = [];
    for (const file of files) {
      try { const project = parseProject(file); updateCppProperties(project); projects.push(project); }
      catch (e) { vscode.window.showWarningMessage(`Cannot parse project '${path.basename(file)}': ${e.message}`); }
    }
    provider.setProjects(projects);
  }
  async function open(file) {
    if (file && typeof file !== 'string') file = file.fsPath;
    if (!file) file = await pickProject();
    if (!file) return;
    try { const project = parseProject(file); updateCppProperties(project); provider.addProject(project); }
    catch (e) { vscode.window.showErrorMessage(`Cannot parse project: ${e.message}`); }
  }
  function commandTarget(item) {
    let project;
    let index;
    if (item && item.kind === 'target' && item.data && item.data.project) {
      project = item.data.project;
      index = item.data.index;
    } else {
      project = provider.projects.find(candidate => candidate.file === provider.activeProjectFile) || provider.project;
      index = project && project.activeTargetIndex || 0;
    }
    if (!project || !project.targets[index]) return undefined;
    project.activeTargetIndex = index;
    provider.activeProjectFile = project.file;
    provider.changed.fire();
    return { project, index, target: project.targets[index] };
  }
  context.subscriptions.push(
    vscode.commands.registerCommand('c251.openProject', open),
    vscode.commands.registerCommand('c251.refresh', refreshProjects),
    vscode.commands.registerCommand('c251.selectTarget', async () => {
      const choices = provider.projects.flatMap(project => project.targets.map((target, index) => ({
        label: target.name,
        description: project.name.replace(/\.uvprojx?$/i, ''),
        project,
        index
      })));
      if (!choices.length) return;
      const choice = await vscode.window.showQuickPick(choices, { placeHolder: 'Select Keil C251 target' });
      if (choice) {
        choice.project.activeTargetIndex = choice.index;
        provider.activeProjectFile = choice.project.file;
        provider.changed.fire();
      }
    }),
    vscode.commands.registerCommand('c251.build', item => {
      const selected = commandTarget(item);
      return selected && runUv4(selected.project.file, selected.target.name, 'build');
    }),
    vscode.commands.registerCommand('c251.rebuild', item => {
      const selected = commandTarget(item);
      return selected && runUv4(selected.project.file, selected.target.name, 'rebuild');
    }),
    vscode.commands.registerCommand('c251.download', item => {
      const selected = commandTarget(item);
      return selected && runUv4(selected.project.file, selected.target.name, 'download');
    })
  );
  const refreshTimer = { value: undefined };
  function scheduleRefresh() {
    if (refreshTimer.value) clearTimeout(refreshTimer.value);
    refreshTimer.value = setTimeout(() => { refreshTimer.value = undefined; refreshProjects(); }, 250);
  }
  for (const folder of (vscode.workspace.workspaceFolders || [])) {
    for (const pattern of ['**/*.uvproj', '**/*.uvprojx']) {
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, pattern));
      watcher.onDidCreate(scheduleRefresh, undefined, context.subscriptions);
      watcher.onDidChange(scheduleRefresh, undefined, context.subscriptions);
      watcher.onDidDelete(scheduleRefresh, undefined, context.subscriptions);
      context.subscriptions.push(watcher);
    }
  }
  refreshProjects();
}
function deactivate() {}
module.exports = { activate, deactivate };
