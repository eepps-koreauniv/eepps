/*
 * Loads the lab bulletin board ("게시판"). Posts live as plain files under
 * content/board/{YYYY-MM-DD-slug}/ (ko.txt, en.txt, 1.jpg, 2.jpg, ...) —
 * there's no server, so the list of posts and their basic info (title,
 * date, photo count) comes from content/board/manifest.json, which
 * scripts/update-board-manifest.ps1 regenerates by scanning that folder.
 */
(function () {
  'use strict';

  window.BOARD_MANIFEST_URL = 'content/board/manifest.json';

  function formatDate(dateStr) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr || '');
    return m ? (m[1] + '.' + m[2] + '.' + m[3]) : (dateStr || '');
  }

  // "Title\n\nBody text..." -> { title, body }. Any number of blank lines
  // after the title are treated as the single separator.
  function parsePostText(text) {
    var lines = (text || '').replace(/\r\n/g, '\n').split('\n');
    var title = (lines[0] || '').trim();
    var i = 1;
    while (i < lines.length && lines[i].trim() === '') i++;
    var body = lines.slice(i).join('\n').trim();
    return { title: title, body: body };
  }

  window.BoardHelpers = { formatDate: formatDate, parsePostText: parsePostText };

  window.loadBoardManifest = function () {
    return fetch(window.BOARD_MANIFEST_URL).then(function (res) {
      if (!res.ok) throw new Error('Board manifest fetch failed: ' + res.status);
      return res.json();
    }).then(function (posts) {
      posts = (posts || []).slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
      return posts;
    });
  };

  // lang is 'ko' or 'en'; falls back to the other language's file if one is
  // missing (e.g. a post that hasn't been translated yet).
  window.loadBoardPost = function (slug, lang) {
    var encodedSlug = encodeURIComponent(slug);
    var primary = 'content/board/' + encodedSlug + '/' + lang + '.txt';
    var fallback = 'content/board/' + encodedSlug + '/' + (lang === 'en' ? 'ko' : 'en') + '.txt';
    return fetch(primary).then(function (res) {
      if (!res.ok) throw new Error('not found');
      return res.text();
    }).catch(function () {
      return fetch(fallback).then(function (res) {
        if (!res.ok) throw new Error('Board post fetch failed for ' + slug);
        return res.text();
      });
    }).then(parsePostText);
  };
})();
