/*
 * Loads research output (publications/projects/talks) from the lab's
 * "연구 업적" Google Sheet (published as CSV), and derives the hero stats
 * (cumulative publications, active projects) from the same data. Falls back
 * to the placeholder data in content.js if the fetch fails.
 *
 * Sheet columns (as actually set up by the lab):
 * Title(KOR), Title(ENG), Type(KOR), Type(ENG),
 * Authors/Participants/Presenters, Status, Date, Link(if any), Memo
 */
(function () {
  'use strict';

  window.PUBS_CSV_URL = 'https://docs.google.com/spreadsheets/d/1FDkjuDBK51_-jxEAVjTMnTekNxuQIN7D5iRRZpT9XJk/export?format=csv&gid=0';

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

  // Type(KOR) is a free-form dropdown, so classify by keyword rather than an
  // exact list — this is only used for the hero stat counts (cumulative
  // papers / active projects), not for the filter buttons (those are built
  // straight from whatever distinct Type values are actually in the sheet).
  function classify(typeKo) {
    typeKo = typeKo || '';
    if (typeKo.indexOf('논문') !== -1) return 'journal';
    if (typeKo.indexOf('과제') !== -1) return 'project';
    if (typeKo.indexOf('발표') !== -1) return 'talk';
    return 'other';
  }

  function parseYear(dateStr) {
    var m = /(\d{4})/.exec(dateStr || '');
    return m ? m[1] : '';
  }

  window.loadPublications = function () {
    return fetch(window.PUBS_CSV_URL).then(function (res) {
      if (!res.ok) throw new Error('Publications CSV fetch failed: ' + res.status);
      return res.text();
    }).then(function (text) {
      var rows = csvToObjects(text).filter(function (r) {
        return (r['Title(KOR)'] || r['Title(ENG)'] || '').trim();
      });

      var pubs = rows.map(function (r) {
        var typeKo = (r['Type(KOR)'] || '').trim();
        return {
          year: parseYear(r['Date']),
          titleKo: (r['Title(KOR)'] || '').trim(),
          titleEn: (r['Title(ENG)'] || '').trim(),
          typeKo: typeKo,
          typeEn: (r['Type(ENG)'] || '').trim(),
          category: classify(typeKo),
          authors: (r['Authors/Participants/Presenters'] || '').trim(),
          link: (r['Link(if any)'] || '').trim(),
          status: (r['Status'] || '').trim()
        };
      });

      pubs.sort(function (a, b) { return (parseInt(b.year, 10) || 0) - (parseInt(a.year, 10) || 0); });

      // Distinct (typeKo, typeEn) pairs in first-seen order, for filter buttons.
      var seen = {};
      var types = [];
      pubs.forEach(function (p) {
        if (p.typeKo && !seen[p.typeKo]) {
          seen[p.typeKo] = true;
          types.push({ ko: p.typeKo, en: p.typeEn || p.typeKo });
        }
      });

      var counts = { journal: 0, project: 0, talk: 0 };
      pubs.forEach(function (p) { if (counts.hasOwnProperty(p.category)) counts[p.category]++; });

      return { pubs: pubs, types: types, counts: counts };
    });
  };
})();
