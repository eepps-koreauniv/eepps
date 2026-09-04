/*
 * Loads the live member roster from the lab's Google Sheet (published as CSV)
 * so People/Alumni content can be updated by editing the sheet, without
 * touching code. Falls back to the placeholder data in content.js if the
 * fetch fails (offline, sheet made private, etc.).
 */
(function () {
  'use strict';

  window.ROSTER_CSV_URL = 'https://docs.google.com/spreadsheets/d/16fKwuCve-G3qOtYmu8_9GkZyRXt6n3OH/export?format=csv&gid=515412475';

  var GROUP_ORDER = ['연구교수', '박사 수료', '박사 과정', '석사 과정'];
  var GROUP_LABELS = {
    '연구교수': { ko: '연구교수', en: 'Research Professor' },
    '박사 수료': { ko: '박사 수료', en: 'Ph.D. Candidate' },
    '박사 과정': { ko: '박사 과정', en: 'Ph.D. Students' },
    '석사 과정': { ko: '석사 과정', en: 'M.S. Students' },
    'researcher_intern': { ko: '연구원 · 연구 인턴', en: 'Researcher · Research Intern' }
  };
  var DEGREE_LABEL = {
    '박사': { ko: '박사', en: 'Ph.D.' },
    '석사': { ko: '석사', en: 'M.S.' }
  };

  function parseCSV(text) {
    var rows = [], row = [], field = '', inQuotes = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
        } else {
          field += c;
        }
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field); field = '';
      } else if (c === '\r') {
        // skip
      } else if (c === '\n') {
        row.push(field); rows.push(row); row = []; field = '';
      } else {
        field += c;
      }
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function csvToObjects(text) {
    var rows = parseCSV(text).filter(function (r) { return r.length > 1 || (r[0] || '').trim() !== ''; });
    if (!rows.length) return [];
    var header = rows[0].map(function (h) { return h.trim(); });
    return rows.slice(1).map(function (r) {
      var obj = {};
      header.forEach(function (h, i) { obj[h] = (r[i] || '').trim(); });
      return obj;
    });
  }

  function cleanTopic(raw) {
    if (!raw) return '';
    return raw.split('\n')
      .map(function (l) { return l.replace(/^[-•\s]+/, '').trim(); })
      .filter(Boolean)
      .join(' · ');
  }

  // Photo files are named by the sheet's "NO" column, zero-padded to two
  // digits (e.g. "31") — matching by name broke for members whose photo
  // was saved under a different name spelling than the sheet. Returns the
  // base filename with no extension; script.js tries multiple extensions
  // (png/jpg/jpeg) against this base since photos come in different formats.
  function photoFileFor(no) {
    if (!no) return null;
    return String(no).trim().padStart(2, '0');
  }

  // A cell can hold multiple links, one per line (Alt+Enter inside the
  // Sheets cell). Each line is either "Label | url" or just a bare url
  // (script.js falls back to the domain name as the label in that case).
  function parseLinks(raw) {
    if (!raw) return [];
    return raw.split('\n')
      .map(function (line) { return line.trim(); })
      .filter(Boolean)
      .map(function (line) {
        var pipeIdx = line.indexOf('|');
        if (pipeIdx === -1) return { label: null, url: line };
        return { label: line.slice(0, pipeIdx).trim(), url: line.slice(pipeIdx + 1).trim() };
      })
      .filter(function (l) { return l.url; });
  }

  function personDisplay(lang, korName, enName) {
    if (lang === 'en') return { name: enName || korName || '', sub: enName && korName ? korName : '' };
    return { name: korName || enName || '', sub: korName && enName ? enName : '' };
  }

  function degreeLine(lang, year, degree) {
    var degLabel = (DEGREE_LABEL[degree] && DEGREE_LABEL[degree][lang]) || degree || '';
    var parts = lang === 'en' ? [degLabel, year] : [year, degLabel];
    return parts.filter(Boolean).join(' ');
  }

  window.RosterHelpers = {
    cleanTopic: cleanTopic,
    photoFileFor: photoFileFor,
    personDisplay: personDisplay,
    degreeLine: degreeLine,
    parseLinks: parseLinks,
    GROUP_LABELS: GROUP_LABELS
  };

  window.loadRoster = function () {
    return fetch(window.ROSTER_CSV_URL).then(function (res) {
      if (!res.ok) throw new Error('Roster CSV fetch failed: ' + res.status);
      return res.text();
    }).then(function (text) {
      var people = csvToObjects(text).filter(function (r) {
        return r['Hier'] && (r['Name(KOR)'] || r['Name(ENG)']);
      });

      var pi = people.find(function (r) { return r['Hier'].trim() === '지도교수'; }) || null;
      var alumni = people.filter(function (r) { return r['Hier'].trim().toLowerCase() === 'alumni'; });
      var groups = GROUP_ORDER.map(function (key) {
        return {
          key: key,
          members: people.filter(function (r) { return r['Hier'].trim() === key; })
        };
      }).filter(function (g) { return g.members.length > 0; });

      // 연구원 and 연구 인턴 share one combined section, researchers first.
      var researchIntern = people.filter(function (r) { return r['Hier'].trim() === '연구원'; })
        .concat(people.filter(function (r) { return r['Hier'].trim() === '연구 인턴'; }));
      if (researchIntern.length) groups.push({ key: 'researcher_intern', members: researchIntern });

      return { pi: pi, alumni: alumni, groups: groups };
    });
  };
})();
