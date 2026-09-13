const fs = require('fs');
const path = require('path');

function text(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim() : '';
}

function blocks(xml, tag) {
  const result = [];
  const tokens = new RegExp(`<\\/?${tag}(?:\\s[^>]*)?>`, 'gi');
  let depth = 0;
  let bodyStart = -1;
  let match;
  while ((match = tokens.exec(xml))) {
    const closing = match[0][1] === '/';
    if (!closing) {
      if (depth === 0) bodyStart = tokens.lastIndex;
      depth += 1;
    } else if (depth > 0) {
      depth -= 1;
      if (depth === 0 && bodyStart >= 0) result.push(xml.slice(bodyStart, match.index));
    }
  }
  return result;
}

function section(xml, tag) {
  const start = xml.search(new RegExp(`<${tag}(?:\\s[^>]*)?>`, 'i'));
  if (start < 0) return '';
  const bodyStart = xml.indexOf('>', start) + 1;
  const end = xml.search(new RegExp(`</${tag}>`, 'i'));
  return end > bodyStart ? xml.slice(bodyStart, end) : '';
}

function parseProject(file) {
  const xml = fs.readFileSync(file, 'utf8');
  const targets = blocks(section(xml, 'Targets'), 'Target').map(targetXml => {
    const target251Xml = section(targetXml, 'Target251');
    const c251Xml = section(target251Xml, 'C251');
    return {
      name: text(targetXml, 'TargetName') || 'Target',
      device: text(targetXml, 'Device'),
      isC251: Boolean(target251Xml),
      includePaths: (text(c251Xml, 'IncludePath') || '').split(';').map(p => p.trim()).filter(Boolean),
      defines: (text(c251Xml, 'Define') || '').split(/[,;\s]+/).map(p => p.trim()).filter(Boolean),
      groups: blocks(section(targetXml, 'Groups'), 'Group').map(groupXml => ({
        name: text(groupXml, 'GroupName') || 'Sources',
        files: blocks(section(groupXml, 'Files'), 'File').map(fileXml => ({
          name: text(fileXml, 'FileName'),
          path: text(fileXml, 'FilePath')
        })).filter(f => f.name)
      })).filter(g => g.files.length)
    };
  });
  return { file, name: path.basename(file), targets: targets.length ? targets : [{ name: 'Target 1', groups: [] }] };
}

function resolveFile(projectFile, filePath, fileName) {
  const projectDir = path.dirname(projectFile);
  const clean = (filePath || fileName || '').replace(/[\\/]+/g, path.sep);
  const candidates = [path.resolve(projectDir, clean), path.resolve(projectDir, fileName || '')];
  return candidates.find(fs.existsSync) || candidates[0];
}

module.exports = { parseProject, resolveFile };
