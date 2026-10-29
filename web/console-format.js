(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ConsoleFeed = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);

  const MINECRAFT_COLORS = {
    '0': '0', '1': '1', '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7',
    '8': '8', '9': '9', a: 'a', b: 'b', c: 'c', d: 'd', e: 'e', f: 'f',
    g: 'e', h: 'f', i: '7', j: '8', m: '4', t: '6', u: 'e', v: 'a', s: 'b', p: '1', q: '5'
  };
  const ANSI_COLORS = {
    30: '0', 31: '4', 32: '2', 33: '6', 34: '1', 35: '5', 36: '3', 37: '7',
    90: '8', 91: 'c', 92: 'a', 93: 'e', 94: '9', 95: 'd', 96: 'b', 97: 'f'
  };
  const COLOR_RGB = {
    '0': [99, 112, 104], '1': [111, 131, 221], '2': [87, 170, 104], '3': [86, 182, 178],
    '4': [220, 104, 98], '5': [184, 115, 199], '6': [210, 154, 79], '7': [183, 192, 185],
    '8': [125, 136, 128], '9': [135, 160, 255], a: [123, 217, 141], b: [118, 217, 212],
    c: [255, 137, 131], d: [227, 154, 239], e: [242, 207, 109], f: [243, 246, 243]
  };
  const FORMAT_TOKEN = /(\u00a7x(?:\u00a7[0-9a-f]){6}|\x1b\[[0-?]*[ -/]*[@-~]|\u00a7[0-9a-z]|\u00a7[\s\S])/ig;
  // MiniMessage tags that some servers log raw. Only these known tags are
  // removed, so vanilla "<PlayerName>" chat stays intact.
  const MINIMESSAGE_TAG = /<\/?(?:#[0-9a-f]{6}|color(?::[^>]*)?|colour(?::[^>]*)?|gradient(?::[^>]*)?|rainbow|bold|b|italic|i|underlined|u|strikethrough|st|obfuscated|obf|reset)>/gi;
  // Geyser Bedrock item tokens and custom font glyphs in Unicode Private Use Area.
  const ITEM_TAG = /\[item\/([a-z0-9_]+)@items\]/gi;
  const PUA_GLYPHS = /[\uE000-\uF8FF]/g;
  // Channel/shard marker printed before every Complex chat line.
  const CHANNEL_MARKER = /[\u258c\u258e\u258f]/g;

  function normalizeFormatting(value) {
    return String(value ?? '')
      .replace(/\\(?:u001b|x1b|033)/ig, '\x1b')
      .replace(/\\u00a7/ig, '\u00a7')
      .replace(MINIMESSAGE_TAG, '')
      .replace(ITEM_TAG, (m, name) => '[' + name.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') + ']')
      .replace(PUA_GLYPHS, '');
  }


  function nearestColor(red, green, blue) {
    let best = 'f';
    let distance = Infinity;
    for (const [code, rgb] of Object.entries(COLOR_RGB)) {
      const candidate = (red - rgb[0]) ** 2 + (green - rgb[1]) ** 2 + (blue - rgb[2]) ** 2;
      if (candidate < distance) {
        best = code;
        distance = candidate;
      }
    }
    return best;
  }

  function xtermColor(index) {
    const value = Math.max(0, Math.min(255, Number(index) || 0));
    if (value < 16) {
      const order = ['0', '4', '2', '6', '1', '5', '3', '7', '8', 'c', 'a', 'e', '9', 'd', 'b', 'f'];
      return order[value];
    }
    if (value >= 232) {
      const gray = 8 + (value - 232) * 10;
      return nearestColor(gray, gray, gray);
    }
    const cube = value - 16;
    const channel = component => component === 0 ? 0 : 55 + component * 40;
    return nearestColor(channel(Math.floor(cube / 36)), channel(Math.floor(cube / 6) % 6), channel(cube % 6));
  }

  function stripFormatting(value) {
    return normalizeFormatting(value)
      .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
      .replace(/\u00a7x(?:\u00a7[0-9a-f]){6}/ig, '')
      // Servers also emit "§" followed by non-standard letters (e.g. §h, §v)
      // as colour markers; drop any remaining "§<char>" so names stay clean.
      .replace(/\u00a7[\s\S]/g, '');
  }

  // Plain text used only for classifying a line: formatting gone, channel
  // marker gone, whitespace collapsed. Display keeps the marker and colours.
  function plainForMatch(value) {
    return stripFormatting(value)
      .replace(CHANNEL_MARKER, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function formatServerNotice(value) {
    const source = normalizeFormatting(value);
    // Complex uses U+7006 as an icon in its server resource pack. Outside
    // Minecraft it falls back to a CJK glyph, and the tip is emitted as one
    // long, space-padded component rather than separate chat lines.
    const plain = stripFormatting(source).trimStart();
    if (!/^\u7006\s+Did you know\?\s+\(\/tips\)/u.test(plain)) return source;
    return source
      .replace(/\u7006/g, '✦')
      .replace(/ {3,}/g, '\n');
  }

  function classesFor(style) {
    const classes = [];
    if (style.color) classes.push(`mc-color-${style.color}`);
    if (style.bold) classes.push('mc-bold');
    if (style.italic) classes.push('mc-italic');
    if (style.underline) classes.push('mc-underline');
    if (style.strike) classes.push('mc-strike');
    return classes;
  }

  function renderMinecraftText(value) {
    const source = normalizeFormatting(value);
    const style = {color: '', bold: false, italic: false, underline: false, strike: false};
    let cursor = 0;
    let html = '';
    let match;

    const append = (text) => {
      if (!text) return;
      const escaped = escapeHtml(text);
      const classes = classesFor(style);
      html += classes.length ? `<span class="${classes.join(' ')}">${escaped}</span>` : escaped;
    };
    const reset = () => {
      style.color = '';
      style.bold = style.italic = style.underline = style.strike = false;
    };

    FORMAT_TOKEN.lastIndex = 0;
    while ((match = FORMAT_TOKEN.exec(source))) {
      append(source.slice(cursor, match.index));
      const token = match[0];
      if (token.charCodeAt(0) === 0x1b) {
        if (!token.toLowerCase().endsWith('m')) {
          cursor = FORMAT_TOKEN.lastIndex;
          continue;
        }
        const codes = token.slice(2, -1).split(';').filter(Boolean).map(Number);
        const sequence = codes.length ? codes : [0];
        for (let index = 0; index < sequence.length; index += 1) {
          const code = sequence[index];
          if (code === 0) reset();
          else if (code === 1) style.bold = true;
          else if (code === 3) style.italic = true;
          else if (code === 4) style.underline = true;
          else if (code === 9) style.strike = true;
          else if (code === 22) style.bold = false;
          else if (code === 23) style.italic = false;
          else if (code === 24) style.underline = false;
          else if (code === 29) style.strike = false;
          else if (code === 39) style.color = '';
          else if (code === 38 && sequence[index + 1] === 5 && sequence[index + 2] !== undefined) {
            style.color = xtermColor(sequence[index + 2]);
            index += 2;
          }
          else if (code === 38 && sequence[index + 1] === 2 && sequence.slice(index + 2, index + 5).length === 3) {
            style.color = nearestColor(...sequence.slice(index + 2, index + 5).map(channel => Math.max(0, Math.min(255, channel))));
            index += 4;
          }
          else if (ANSI_COLORS[code]) style.color = ANSI_COLORS[code];
        }
      } else {
        const code = token.slice(1).toLowerCase();
        if (code.startsWith('x')) {
          const hex = [...token.matchAll(/\u00a7([0-9a-f])/ig)].map(part => part[1]).join('');
          reset();
          style.color = nearestColor(
            Number.parseInt(hex.slice(0, 2), 16),
            Number.parseInt(hex.slice(2, 4), 16),
            Number.parseInt(hex.slice(4, 6), 16)
          );
        } else if (MINECRAFT_COLORS[code]) {
          reset();
          style.color = MINECRAFT_COLORS[code];
        } else if (code === 'l') style.bold = true;
        else if (code === 'm') style.strike = true;
        else if (code === 'n') style.underline = true;
        else if (code === 'o') style.italic = true;
        else if (code === 'r') reset();
        // Obfuscated text (k) is deliberately left readable in an operator console.
      }
      cursor = FORMAT_TOKEN.lastIndex;
    }
    append(source.slice(cursor));
    return html;
  }

  const RANK_PREFIX = '(?:\\[[^\\]\\r\\n]{1,40}\\]\\s*)*';

  function playerNameFrom(message) {
    const plain = plainForMatch(message);
    // Complex prefixes every line with a channel marker and sometimes a shard
    // name ("▌ Skyblock [Noble] Jlorenzoo*: ..."), so allow a short leading
    // run without a rank bracket before the ranked name.
    const ranked = plain.match(/^[^\[]*(?:\[[^\]\r\n]{1,40}\]\s*)+([A-Za-z0-9_]{3,16})[^\s:]*:\s*/u);
    if (ranked) return ranked[1];
    const vanilla = plain.match(/^<([A-Za-z0-9_]{3,16})>\s+/);
    return vanilla ? vanilla[1] : '';
  }

  // Private messages use many shapes across servers: "Name ➜ You: hi",
  // "You ➜ Name: hi", "Name whispers to you: hi", vanilla "From Name: hi".
  // Returns the other party, the direction, and the message body, or null.
  function whisperInfo(message) {
    const plain = plainForMatch(message);
    const arrow = '(?:➜|→|➤|⇒|->)';
    let match = plain.match(new RegExp(`([A-Za-z0-9_]{3,16})\\*?\\s*${arrow}\\s*[Yy]ou\\b\\s*:?\\s*(.*)$`, 'su'));
    if (match) return {direction: 'in', player: match[1], body: match[2].trim()};
    match = plain.match(new RegExp(`^[Yy]ou\\*?\\s*${arrow}\\s*([A-Za-z0-9_]{3,16})\\b\\s*:?\\s*(.*)$`, 'su'));
    if (match) return {direction: 'out', player: match[1], body: match[2].trim()};
    match = plain.match(new RegExp(`^${RANK_PREFIX}([A-Za-z0-9_]{3,16})\\s+whispers?\\s*(?:to\\s+you)?\\s*:\\s*(.*)$`, 'isu'));
    if (match) return {direction: 'in', player: match[1], body: match[2].trim()};
    match = plain.match(new RegExp(`^${RANK_PREFIX}[Yy]ou\\s+whispers?\\s+to\\s+([A-Za-z0-9_]{3,16})\\s*:\\s*(.*)$`, 'isu'));
    if (match) return {direction: 'out', player: match[1], body: match[2].trim()};
    match = plain.match(new RegExp(`^${RANK_PREFIX}From\\s+([A-Za-z0-9_]{3,16})\\s*:\\s*(.*)$`, 'isu'));
    if (match) return {direction: 'in', player: match[1], body: match[2].trim()};
    match = plain.match(new RegExp(`^${RANK_PREFIX}To\\s+([A-Za-z0-9_]{3,16})\\s*:\\s*(.*)$`, 'isu'));
    if (match) return {direction: 'out', player: match[1], body: match[2].trim()};
    return null;
  }

  function logTone(message, fallback) {
    const plain = stripFormatting(message);
    if (/Skipped unparseable packet|Suppressed packet parsing/i.test(plain)) return 'client';
    if (/\b(?:FATAL|ERROR|SEVERE)\b|\b(?:Exception|Error executing|Caused by:)\b/i.test(plain)) return 'error';
    if (/\bWARN(?:ING)?\b/i.test(plain)) return 'warning';
    return fallback;
  }

  function linesAfterClear(lines, baseline) {
    const hidden = new Map();
    baseline.forEach(line => hidden.set(line, (hidden.get(line) || 0) + 1));
    return lines.filter(line => {
      const remaining = hidden.get(line) || 0;
      if (!remaining) return true;
      hidden.set(line, remaining - 1);
      return false;
    });
  }

  function parseConsoleLine(line) {
    const source = String(line ?? '');
    const match = source.match(/^\[([^\]]+)\]\s+(?:\[(YOU|SERVER|CLIENT)\]\s+)?(.*)$/);
    if (!match) {
      return {time: '', kind: 'CLIENT', category: 'client', tone: logTone(source, 'client'), message: source, player: ''};
    }
    const [, time, explicitOrigin, body] = match;
    const isClientMessage = explicitOrigin === 'CLIENT' || (!explicitOrigin && body.startsWith('[ALT-PILOT]'));
    const origin = explicitOrigin || (isClientMessage ? 'CLIENT' : 'SERVER');
    const message = (!explicitOrigin && body.startsWith('[ALT-PILOT]')) ? body.replace(/^\[ALT-PILOT\]\s*/, '') : body;

    if (origin === 'YOU') {
      return {time, kind: 'YOU', category: 'self', tone: 'sent', message, player: ''};
    }
    if (origin === 'CLIENT') {
      return {time, kind: 'CLIENT', category: 'client', tone: logTone(message, 'client'), message, player: ''};
    }
    const whisper = whisperInfo(message);
    if (whisper) {
      return {
        time, kind: 'WHISPER', category: 'whisper', tone: whisper.direction === 'out' ? 'sent' : 'whisper',
        message, player: whisper.player, direction: whisper.direction
      };
    }
    const player = playerNameFrom(message);
    return player
      ? {time, kind: 'PLAYER', category: 'player', tone: 'player', message, player}
      : {time, kind: 'SERVER', category: 'server', tone: logTone(message, 'server'), message, player: ''};
  }


  function selectEntries(entries, filter = 'conversation', query = '') {
    const search = String(query).trim().toLowerCase();
    return entries.filter(entry => {
      const issue = ['error', 'warning', 'attention', 'progress'].includes(entry.tone);
      const matches = filter === 'all' || (filter === 'conversation'
        ? ['player', 'whisper', 'self'].includes(entry.category) || issue
        : filter === 'attention' ? issue : entry.category === filter);
      return matches && (!search || stripFormatting(entry.message).toLowerCase().includes(search));
    });
  }

  function compactEntries(entries) {
    const rows = [];
    for (const entry of entries) {
      const previous = rows[rows.length - 1];
      if (previous && ['server', 'client'].includes(entry.category)
          && previous.category === entry.category && previous.message === entry.message
          && previous.tone === entry.tone) {
        previous.repeats += 1;
        previous.time = entry.time;
      } else rows.push({...entry, repeats: 1});
    }
    return rows;
  }

  return {selectEntries, compactEntries, formatServerNotice, linesAfterClear, parseConsoleLine, playerNameFrom, plainForMatch, whisperInfo, renderMinecraftText, stripFormatting};
});
