(function () {
  'use strict';

  var SECTION_IDS = ['main', 'people', 'research', 'board', 'contact'];
  var NAV_GLYPHS = ['◎', '✳', '◇', '▤', '✦'];
  var PUB_PAGE_SIZE = 10;

  // Photo files get replaced under the same filename (e.g. someone re-saves
  // "33.png" with a different person's photo), and browsers then keep
  // showing the old cached bytes for that URL. Appending this per-page-load
  // value forces a fresh fetch every time the site is loaded.
  var CACHE_BUST = Date.now();

  var state = {
    lang: 'ko',
    section: 'main',
    alumniOpen: false,
    filterIdx: 0,
    expanded: false,
    boardSlug: null // null = board list view; otherwise the open post's slug
  };

  var ROSTER = null; // populated by loadRoster() from the Google Sheet; null = use content.js placeholder data
  var PUBS = null; // populated by loadPublications() from the Google Sheet; null = use content.js placeholder data
  var BOARD_POSTS = null; // populated by loadBoardManifest(); null = not loaded yet
  var boardPostCache = {}; // slug -> { title, body } per language, so re-renders (lang toggle) don't refetch

  function t() { return window.COPY[state.lang]; }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  var PHOTO_EXTENSIONS = ['png', 'jpg', 'jpeg', 'PNG', 'JPG', 'JPEG'];

  // `baseName` has no extension (e.g. "31") — tries each extension in turn
  // (photos are a mix of png/jpg exports) and falls back to the stripe
  // placeholder only once every extension has failed to load.
  function setPhoto(container, baseName, alt, caption) {
    caption = caption || 'photo';
    container.classList.remove('stripe-pattern');
    container.innerHTML = '';
    if (!baseName) {
      container.classList.add('stripe-pattern');
      container.appendChild(el('span', 'stripe-caption', caption));
      return;
    }
    var img = document.createElement('img');
    img.alt = alt || '';
    img.style.cssText = 'position:absolute; inset:0; width:100%; height:100%; object-fit:cover; display:block;';
    var extIdx = 0;
    function tryNextExtension() {
      if (extIdx >= PHOTO_EXTENSIONS.length) {
        container.classList.add('stripe-pattern');
        container.innerHTML = '<span class="stripe-caption">' + caption + '</span>';
        return;
      }
      img.src = 'assets/people/' + encodeURIComponent(baseName) + '.' + PHOTO_EXTENSIONS[extIdx] + '?v=' + CACHE_BUST;
      extIdx++;
    }
    img.onerror = tryNextExtension;
    container.appendChild(img);
    tryNextExtension();
  }

  function renderNav() {
    var copy = t();
    var nav = document.getElementById('nav-list');
    nav.innerHTML = '';
    SECTION_IDS.forEach(function (id, i) {
      var a = el('a', 'nav-pill' + (state.section === id ? ' active' : ''));
      a.href = '#' + id;
      var dot = el('span', 'nav-dot', NAV_GLYPHS[i]);
      a.appendChild(dot);
      a.appendChild(document.createTextNode(' ' + copy.nav[i]));
      nav.appendChild(a);
    });
    document.querySelectorAll('.lang-toggle button').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.lang === state.lang);
    });
  }

  function renderHero() {
    var copy = t();
    document.getElementById('hero-title').innerHTML =
      copy.heroLine1 + '<br><span>' + copy.heroHl + '</span> ' + copy.heroLine2;
    document.getElementById('hero-lead').textContent = copy.heroLead;

    var stats = document.getElementById('hero-stats');
    stats.innerHTML = '';
    copy.stats.forEach(function (s, i) {
      var label = s[0], value = s[1];
      // stats[0] = cumulative publications, stats[1] = active projects,
      // stats[2] = current researchers (roster minus Alumni) - once the
      // sheets have loaded, replace the placeholder numbers with live counts.
      if (PUBS) {
        if (i === 0) value = pad2(PUBS.counts.journal || 0);
        if (i === 1) value = pad2(PUBS.counts.project || 0);
      }
      if (ROSTER && i === 2) {
        var activeCount = (ROSTER.pi ? 1 : 0) + ROSTER.groups.reduce(function (sum, g) { return sum + g.members.length; }, 0);
        value = pad2(activeCount);
      }
      var card = el('div', 'stat-card');
      card.appendChild(el('span', 'label kr', label));
      card.appendChild(el('span', 'value', value));
      stats.appendChild(card);
    });

    document.getElementById('side-since').textContent = copy.since;
    document.getElementById('side-title').textContent = copy.sideTitle;
    document.getElementById('side-cta').textContent = copy.teamCta + ' ↗';
    document.getElementById('dept-title').textContent = copy.deptCardTitle;
    document.getElementById('dept-cta').textContent = copy.deptCardCta + ' ↗';

    document.getElementById('explore-cta').textContent = copy.exploreCta + ' ↗';
    document.getElementById('work-cta').textContent = copy.workCta;
  }

  // Same multi-extension fallback as setPhoto, but for the research-scope
  // map slots (assets/scope-local.png, scope-national.jpg, etc. — mixed
  // extensions since photos get dropped in by hand).
  function setScopeMapImage(container, baseName, alt, placeholderCaption) {
    container.classList.remove('stripe-pattern');
    container.innerHTML = '';
    if (!baseName) {
      container.classList.add('stripe-pattern');
      container.appendChild(el('span', 'stripe-caption', placeholderCaption || ''));
      return;
    }
    var img = document.createElement('img');
    img.alt = alt || '';
    img.style.cssText = 'position:absolute; inset:0; width:100%; height:100%; object-fit:cover; display:block;';
    var extIdx = 0;
    function tryNextExtension() {
      if (extIdx >= PHOTO_EXTENSIONS.length) {
        container.classList.add('stripe-pattern');
        container.innerHTML = '<span class="stripe-caption">' + (placeholderCaption || '') + '</span>';
        return;
      }
      img.src = 'assets/' + encodeURIComponent(baseName) + '.' + PHOTO_EXTENSIONS[extIdx] + '?v=' + CACHE_BUST;
      extIdx++;
    }
    img.onerror = tryNextExtension;
    container.appendChild(img);
    tryNextExtension();
  }

  function renderScope() {
    var copy = t();
    document.getElementById('scope-title').textContent = copy.scopeTitleFull;

    var grid = document.getElementById('scope-grid');
    grid.querySelectorAll('.scale-card, .core-band').forEach(function (n) { n.remove(); });

    copy.scales.forEach(function (sc, i) {
      var label = sc[0], sub = sc[1], topics = sc[2], mapNote = sc[3];
      var card = el('div', 'scale-card');
      var head = el('div');
      head.appendChild(el('p', 'label', label));
      head.appendChild(el('p', 'sub', sub));
      card.appendChild(head);

      card.classList.add('scale-pos-' + i);

      // Real map images are available for local/regional/national; international
      // still has no asset, so it keeps the striped placeholder.
      var SCALE_MAP_BASENAMES = ['scope-local', 'scope-regional', 'scope-national', null];
      var map = el('div', 'scale-map');
      setScopeMapImage(map, SCALE_MAP_BASENAMES[i], label, mapNote);
      card.appendChild(map);

      var topicsWrap = el('div', 'scale-topics');
      topics.forEach(function (topic) { topicsWrap.appendChild(el('p', null, '— ' + topic)); });
      card.appendChild(topicsWrap);

      grid.appendChild(card);
    });

    var core = el('div', 'core-band');
    copy.coreThemes.forEach(function (theme) { core.appendChild(el('span', 'core-pill', theme)); });
    grid.appendChild(core);
  }

  var alumniCollator = new Intl.Collator('ko');
  function sortAlumni(list) {
    function key(a) {
      var year = parseInt(a['Year of Graduation'], 10);
      var deg = (a['Degree'] || '').trim();
      return {
        year: isNaN(year) ? Infinity : year, // no year -> sort last
        degRank: deg === '박사' ? 0 : deg === '석사' ? 1 : 2, // PhD before Master's
        name: (a['Name(KOR)'] || a['Name(ENG)'] || '').trim()
      };
    }
    return list.slice().sort(function (a, b) {
      var ka = key(a), kb = key(b);
      if (ka.year !== kb.year) return ka.year - kb.year;
      if (ka.degRank !== kb.degRank) return ka.degRank - kb.degRank;
      return alumniCollator.compare(ka.name, kb.name);
    });
  }

  var URL_FIELD = 'Personal webpage (optional)';

  // Sheet entries like "linkedin.com/in/..." have no scheme, so a browser
  // treats them as a path relative to the current page instead of an
  // external site. Add "https://" whenever one isn't already present.
  function normalizeUrl(raw) {
    raw = (raw || '').trim();
    if (!raw) return '';
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return raw;
    return 'https://' + raw;
  }

  // Makes a whole card navigate to `url` on click, without breaking any real
  // <a> already inside it (e.g. the PI card's "email" link) — clicks on an
  // inner link are left alone to behave normally.
  // Builds the row of link buttons for a card's bottom (0 to N buttons,
  // depending on how many lines are in the sheet cell). Returns null when
  // there's nothing to show, so callers can skip appending it.
  function buildLinkButtons(rawLinksField) {
    var links = RosterHelpers.parseLinks(rawLinksField);
    if (!links.length) return null;
    var row = el('div', 'member-links');
    links.forEach(function (l) {
      var url = normalizeUrl(l.url);
      if (!url) return;
      var label = l.label;
      if (!label) {
        try { label = new URL(url).hostname.replace(/^www\./, ''); }
        catch (e) { label = l.url; }
      }
      var btn = el('a', 'member-link-btn', label + ' ↗');
      btn.href = url;
      btn.target = '_blank';
      btn.rel = 'noopener';
      row.appendChild(btn);
    });
    return row;
  }

  function renderPeople() {
    var copy = t();
    document.getElementById('people-title').innerHTML =
      copy.peopleTitleA + ' <span class="hl">' + copy.peopleTitleHl + '</span> ' + copy.peopleTitleB;
    document.getElementById('pi-email-cta').textContent = copy.emailCta + ' ↗';

    var R = ROSTER && window.RosterHelpers;

    // ---- PI card ----
    if (R && ROSTER.pi) {
      var piDisp = RosterHelpers.personDisplay(state.lang, ROSTER.pi['Name(KOR)'], ROSTER.pi['Name(ENG)']);
      document.getElementById('pi-role').textContent = copy.piRole;
      document.getElementById('pi-name').innerHTML =
        piDisp.name + (piDisp.sub ? ' <span class="sub">' + piDisp.sub + '</span>' : '');
      document.getElementById('pi-bio').textContent = RosterHelpers.cleanTopic(ROSTER.pi['Research(ENG)']);
      setPhoto(document.getElementById('pi-portrait'), RosterHelpers.photoFileFor(ROSTER.pi['NO']), piDisp.name, 'portrait');
      var piExistingLinks = document.getElementById('pi-links');
      if (piExistingLinks) piExistingLinks.remove();
      var piLinkRow = buildLinkButtons(ROSTER.pi[URL_FIELD]);
      if (piLinkRow) {
        piLinkRow.id = 'pi-links';
        document.getElementById('pi-email-cta').insertAdjacentElement('afterend', piLinkRow);
      }
    } else {
      document.getElementById('pi-role').textContent = copy.piRole;
      document.getElementById('pi-name').innerHTML =
        copy.piName + ' <span class="sub">' + copy.piNameSub + '</span>';
      document.getElementById('pi-bio').textContent = copy.piBio;
      setPhoto(document.getElementById('pi-portrait'), null, copy.piName, 'portrait');
    }

    var container = document.getElementById('groups-container');
    container.innerHTML = '';

    function buildMemberCard(name, sub, topic, photoFile, linksRaw) {
      var card = el('div', 'member-card');
      var photo = el('div', 'member-photo');
      card.appendChild(photo);
      setPhoto(photo, photoFile, name);
      var textBlock = el('div', 'member-text');
      var names = el('div', 'member-names');
      names.appendChild(el('p', 'kr-name', name));
      if (sub) names.appendChild(el('p', 'en-name', sub));
      textBlock.appendChild(names);
      textBlock.appendChild(el('p', 'member-topic kr', topic || ''));
      card.appendChild(textBlock);
      var linkRow = buildLinkButtons(linksRaw);
      if (linkRow) card.appendChild(linkRow);
      return card;
    }

    if (R) {
      ROSTER.groups.forEach(function (g) {
        var label = (RosterHelpers.GROUP_LABELS[g.key] && RosterHelpers.GROUP_LABELS[g.key][state.lang]) || g.key;
        var wrap = el('div');
        var head = el('div', 'group-head');
        head.appendChild(el('p', 'group-label', label));
        head.appendChild(el('span', 'group-count kr', pad2(g.members.length)));
        head.appendChild(el('span', 'group-rule'));
        wrap.appendChild(head);

        var grid = el('div', 'member-grid');
        g.members.forEach(function (m) {
          var disp = RosterHelpers.personDisplay(state.lang, m['Name(KOR)'], m['Name(ENG)']);
          var topic = RosterHelpers.cleanTopic(m['Research(ENG)']);
          var photoFile = RosterHelpers.photoFileFor(m['NO']);
          grid.appendChild(buildMemberCard(disp.name, disp.sub, topic, photoFile, m[URL_FIELD]));
        });
        wrap.appendChild(grid);
        container.appendChild(wrap);
      });
    } else {
      copy.groups.forEach(function (g) {
        var label = g[0], members = g[1];
        var wrap = el('div');
        var head = el('div', 'group-head');
        head.appendChild(el('p', 'group-label', label));
        head.appendChild(el('span', 'group-count kr', pad2(members.length)));
        head.appendChild(el('span', 'group-rule'));
        wrap.appendChild(head);

        var grid = el('div', 'member-grid');
        members.forEach(function (m) {
          grid.appendChild(buildMemberCard(m[0], m[1], m[2], null, null));
        });
        wrap.appendChild(grid);
        container.appendChild(wrap);
      });
    }

    // ---- Alumni ----
    var alumniList = R ? sortAlumni(ROSTER.alumni) : copy.alumni;
    var alumniWrap = el('div');
    var alumniHead = el('div', 'group-head');
    alumniHead.appendChild(el('p', 'group-label', copy.alumniLabel));
    alumniHead.appendChild(el('span', 'group-count kr', pad2(alumniList.length)));
    alumniHead.appendChild(el('span', 'group-rule'));
    var alumniBtn = el('button', 'group-toggle', state.alumniOpen ? copy.alumniCloseCta : copy.alumniOpenCta);
    alumniBtn.type = 'button';
    alumniBtn.addEventListener('click', function () {
      state.alumniOpen = !state.alumniOpen;
      renderPeople();
    });
    alumniHead.appendChild(alumniBtn);
    alumniWrap.appendChild(alumniHead);

    if (state.alumniOpen) {
      var alumniGrid = el('div', 'member-grid');
      alumniList.forEach(function (a) {
        var name, sub, degree, photoFile, linksRaw;
        if (R) {
          var disp = RosterHelpers.personDisplay(state.lang, a['Name(KOR)'], a['Name(ENG)']);
          name = disp.name; sub = disp.sub;
          degree = RosterHelpers.degreeLine(state.lang, a['Year of Graduation'], a['Degree']);
          photoFile = RosterHelpers.photoFileFor(a['NO']);
          linksRaw = a[URL_FIELD];
        } else {
          name = a[0]; sub = a[1]; degree = a[2]; photoFile = null; linksRaw = null;
        }
        var card = el('div', 'member-card alumni-card');
        var photo = el('div', 'member-photo alumni-photo');
        card.appendChild(photo);
        setPhoto(photo, photoFile, name);
        var top = el('div', 'alumni-top');
        top.appendChild(el('span', 'alumni-degree', degree || ''));
        card.appendChild(top);
        var textBlock = el('div', 'member-text');
        var names = el('div', 'member-names alumni-names');
        names.appendChild(el('p', 'kr-name', name));
        if (sub) names.appendChild(el('p', 'en-name', sub));
        textBlock.appendChild(names);
        card.appendChild(textBlock);
        var linkRow = buildLinkButtons(linksRaw);
        if (linkRow) card.appendChild(linkRow);
        alumniGrid.appendChild(card);
      });
      alumniWrap.appendChild(alumniGrid);
    }
    container.appendChild(alumniWrap);
  }

  function renderResearch() {
    var copy = t();
    document.getElementById('research-title').innerHTML =
      copy.researchTitleA + ' <span class="hl">' + copy.researchTitleHl + '</span> ' + copy.researchTitleB;
    document.getElementById('pub-panel-title').textContent = copy.pubPanelTitle;

    var RP = !!PUBS;
    var allPubs, filterDefs;

    if (RP) {
      allPubs = PUBS.pubs.map(function (p) {
        return {
          year: p.year,
          typeKo: p.typeKo,
          title: state.lang === 'en' ? (p.titleEn || p.titleKo) : (p.titleKo || p.titleEn),
          venue: p.authors,
          badgeLabel: state.lang === 'en' ? (p.typeEn || p.typeKo) : p.typeKo,
          badgeTint: p.category === 'journal' ? 'k1' : p.category === 'talk' ? 'k3' : 'k2',
          link: p.link
        };
      });
      filterDefs = [{ label: state.lang === 'en' ? 'All' : '전체', match: function () { return true; } }]
        .concat(PUBS.types.map(function (ty) {
          return {
            label: state.lang === 'en' ? (ty.en || ty.ko) : ty.ko,
            match: function (p) { return p.typeKo === ty.ko; }
          };
        }));
    } else {
      allPubs = copy.pubs.map(function (p) {
        var tint = { 1: 'k1', 2: 'k2', 3: 'k3' }[p[3]] || 'k2';
        return { year: p[0], title: p[1], venue: p[2], kindIdx: p[3], badgeLabel: copy.filters[p[3]] || '', badgeTint: tint, link: '' };
      });
      filterDefs = copy.filters.map(function (label, i) {
        return { label: label, match: function (p) { return i === 0 || p.kindIdx === i; } };
      });
    }

    if (state.filterIdx >= filterDefs.length) state.filterIdx = 0; // guard against a stale index from before the sheet loaded

    var filters = document.getElementById('filters');
    filters.innerHTML = '';
    filterDefs.forEach(function (f, i) {
      var btn = el('button', 'filter-pill' + (state.filterIdx === i ? ' active' : ''), f.label);
      btn.type = 'button';
      btn.addEventListener('click', function () {
        state.filterIdx = i;
        state.expanded = false;
        renderResearch();
      });
      filters.appendChild(btn);
    });

    var matched = allPubs.filter(filterDefs[state.filterIdx].match);
    var hasMore = matched.length > PUB_PAGE_SIZE;
    var shown = hasMore && !state.expanded ? matched.slice(0, PUB_PAGE_SIZE) : matched;

    var rows = document.getElementById('pub-rows');
    rows.innerHTML = '';
    shown.forEach(function (p) {
      var row = el('div', 'pub-row');
      row.appendChild(el('span', 'year', p.year));
      row.appendChild(el('span', 'pub-badge ' + p.badgeTint, p.badgeLabel));
      row.appendChild(el('p', 'title kr', p.title));
      row.appendChild(el('span', 'venue', p.venue));
      if (p.link) {
        var link = el('a', 'link', '↗');
        link.href = normalizeUrl(p.link); link.target = '_blank'; link.rel = 'noopener';
        row.appendChild(link);
      } else {
        row.appendChild(el('span', 'link', '↗'));
      }
      rows.appendChild(row);
    });

    document.getElementById('pub-count').textContent = copy.countFmt(shown.length, matched.length);

    var action = document.getElementById('pub-footer-action');
    action.innerHTML = '';
    if (hasMore) {
      var toggle = el('button', 'pub-toggle',
        state.expanded ? copy.pubCollapse : copy.pubExpand.replace('{n}', String(matched.length - PUB_PAGE_SIZE)));
      toggle.type = 'button';
      toggle.addEventListener('click', function () {
        state.expanded = !state.expanded;
        renderResearch();
      });
      action.appendChild(toggle);
    } else {
      var link = el('a', 'pub-all-cta', copy.pubAllCta + ' ↗');
      link.href = '#contact';
      action.appendChild(link);
    }
  }

  function renderContact() {
    var copy = t();
    document.getElementById('contact-title').innerHTML =
      copy.contactTitleA + '<br><span class="hl">' + copy.contactTitleB + '</span> ' + copy.contactTitleHl;
    document.getElementById('contact-lead').textContent = copy.contactLead;

    var rows = document.getElementById('contact-rows');
    rows.innerHTML = '';
    copy.contactLabels.forEach(function (label, i) {
      var row = el('div', 'contact-row');
      row.appendChild(el('span', 'clabel', label));
      row.appendChild(el('span', 'cvalue kr', copy.contactValues[i]));
      rows.appendChild(row);
    });

    document.getElementById('footer-left').textContent = copy.footerLeft;
    document.getElementById('footer-right').textContent = copy.footerRight;
  }

  // The manifest lists each post's actual photo filenames (any name, not
  // just numbers), so these just point straight at them — no extension
  // guessing needed.
  function boardPhotoSrc(slug, filename) {
    return 'content/board/' + encodeURIComponent(slug) + '/' + encodeURIComponent(filename) + '?v=' + CACHE_BUST;
  }

  function setBoardThumb(container, slug, filename) {
    container.classList.remove('stripe-pattern');
    container.innerHTML = '';
    var img = document.createElement('img');
    img.alt = '';
    img.style.cssText = 'position:absolute; inset:0; width:100%; height:100%; object-fit:cover; display:block;';
    img.onerror = function () {
      container.classList.add('stripe-pattern');
      container.innerHTML = '<span class="stripe-caption">photo</span>';
    };
    img.src = boardPhotoSrc(slug, filename);
    container.appendChild(img);
  }

  // Horizontal photo carousel for a post's detail view — arrow buttons
  // step through slides, no lightbox/zoom. Single-photo posts get no
  // arrows or counter, just the photo.
  function buildBoardCarousel(photos, slug) {
    var wrap = el('div', 'board-carousel');
    var track = el('div', 'board-carousel-track');
    photos.forEach(function (filename) {
      var img = document.createElement('img');
      img.alt = '';
      img.onerror = function () { img.remove(); };
      img.src = boardPhotoSrc(slug, filename);
      track.appendChild(img);
    });
    wrap.appendChild(track);

    if (photos.length > 1) {
      var idx = 0;
      var counter = el('span', 'board-carousel-counter', '1 / ' + photos.length);
      function update() {
        track.style.transform = 'translateX(-' + (idx * 100) + '%)';
        counter.textContent = (idx + 1) + ' / ' + photos.length;
      }
      var prev = el('button', 'board-carousel-arrow prev', '‹');
      prev.type = 'button';
      prev.addEventListener('click', function () { idx = (idx - 1 + photos.length) % photos.length; update(); });
      var next = el('button', 'board-carousel-arrow next', '›');
      next.type = 'button';
      next.addEventListener('click', function () { idx = (idx + 1) % photos.length; update(); });
      wrap.appendChild(prev);
      wrap.appendChild(next);
      wrap.appendChild(counter);
    }
    return wrap;
  }

  function renderBoardList(container, copy) {
    if (!BOARD_POSTS || !BOARD_POSTS.length) {
      container.appendChild(el('p', 'board-empty', copy.boardEmpty));
      return;
    }
    var grid = el('div', 'board-grid');
    BOARD_POSTS.forEach(function (post) {
      var title = state.lang === 'en' ? (post.titleEn || post.titleKo) : (post.titleKo || post.titleEn);
      var card = el('div', 'board-card');
      var thumb = el('div', 'board-thumb');
      card.appendChild(thumb);
      if (post.photos && post.photos.length) setBoardThumb(thumb, post.slug, post.photos[0]);
      else { thumb.classList.add('stripe-pattern'); thumb.appendChild(el('span', 'stripe-caption', 'photo')); }
      var body = el('div', 'board-card-body');
      body.appendChild(el('p', 'board-card-title kr', title));
      body.appendChild(el('span', 'board-card-date', BoardHelpers.formatDate(post.date)));
      card.appendChild(body);
      card.addEventListener('click', function () { location.hash = 'board/' + encodeURIComponent(post.slug); });
      grid.appendChild(card);
    });
    container.appendChild(grid);
  }

  function renderBoardDetail(container, copy) {
    var slug = state.boardSlug;
    var post = BOARD_POSTS && BOARD_POSTS.find(function (p) { return p.slug === slug; });

    var back = el('a', 'board-back', '← ' + copy.boardBackCta);
    back.href = '#board';
    container.appendChild(back);

    if (!post) {
      container.appendChild(el('p', 'board-empty', copy.boardEmpty));
      return;
    }

    var cacheKey = slug + '|' + state.lang;
    var cached = boardPostCache[cacheKey];
    if (!cached) {
      container.appendChild(el('p', 'board-empty', '...'));
      window.loadBoardPost(slug, state.lang).then(function (parsed) {
        boardPostCache[cacheKey] = parsed;
        if (state.boardSlug === slug) renderBoard(); // still viewing this post
      }).catch(function (err) {
        console.warn('Could not load board post', slug, err);
        boardPostCache[cacheKey] = { title: post.titleKo || post.titleEn, body: '' };
        if (state.boardSlug === slug) renderBoard();
      });
      return;
    }

    var article = el('div');
    article.appendChild(el('p', 'board-detail-date', BoardHelpers.formatDate(post.date)));
    article.appendChild(el('h3', 'board-detail-title', cached.title));
    article.appendChild(el('p', 'board-detail-body kr', cached.body));
    if (post.photos && post.photos.length) {
      article.appendChild(buildBoardCarousel(post.photos, slug));
    }
    container.appendChild(article);
  }

  function renderBoard() {
    var copy = t();
    document.getElementById('board-title').textContent = copy.boardTitleFull;

    var container = document.getElementById('board-container');
    container.innerHTML = '';
    if (state.boardSlug) renderBoardDetail(container, copy);
    else renderBoardList(container, copy);
  }

  function syncBoardStateFromHash() {
    var m = /^#board\/(.+)$/.exec(location.hash);
    state.boardSlug = m ? decodeURIComponent(m[1]) : null;
  }

  window.addEventListener('hashchange', function () {
    syncBoardStateFromHash();
    renderBoard();
    if (location.hash.indexOf('#board') === 0) {
      var section = document.getElementById('board');
      if (section) section.scrollIntoView();
    }
  });

  function renderAll() {
    renderNav();
    renderHero();
    renderScope();
    renderPeople();
    renderResearch();
    renderBoard();
    renderContact();
    document.documentElement.lang = state.lang;
  }

  document.getElementById('lang-toggle').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-lang]');
    if (!btn) return;
    state.lang = btn.dataset.lang;
    renderAll();
  });

  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        state.section = entry.target.id;
        renderNav();
      }
    });
  }, { rootMargin: '-45% 0px -50% 0px' });

  var HERO_SLIDE_MS = 5000;

  // The photo list itself is never hardcoded here — it's read from
  // assets/hero/manifest.json, which just lists whatever is in that folder.
  // Run scripts/update-hero-manifest.ps1 after adding/removing photos there.
  function heroPlaceholder(container) {
    container.classList.add('stripe-pattern');
    container.appendChild(el('span', 'stripe-caption', 'lab / field research photo'));
  }

  function initHeroSlideshow() {
    var container = document.getElementById('hero-image');
    if (!container) return;

    fetch('assets/hero/manifest.json').then(function (res) {
      if (!res.ok) throw new Error('manifest fetch failed: ' + res.status);
      return res.json();
    }).then(function (filenames) {
      if (!filenames || !filenames.length) { heroPlaceholder(container); return; }

      var slides = filenames.map(function (name, i) {
        var img = document.createElement('img');
        img.className = 'hero-slide' + (i === 0 ? ' active' : '');
        img.alt = '';
        img.onerror = function () { img.remove(); };
        img.src = 'assets/hero/' + encodeURIComponent(name) + '?v=' + CACHE_BUST;
        container.insertBefore(img, container.firstChild);
        return img;
      });

      var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduceMotion || slides.length < 2) return;

      var idx = 0;
      setInterval(function () {
        var current = slides[idx];
        idx = (idx + 1) % slides.length;
        var next = slides[idx];
        if (current) current.classList.remove('active');
        if (next) next.classList.add('active');
      }, HERO_SLIDE_MS);
    }).catch(function (err) {
      console.warn('Could not load hero photo manifest — showing placeholder.', err);
      heroPlaceholder(container);
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    syncBoardStateFromHash();
    renderAll(); // render immediately with placeholder data so the page isn't blank while the sheet loads
    initHeroSlideshow();
    SECTION_IDS.forEach(function (id) {
      var target = document.getElementById(id);
      if (target) observer.observe(target);
    });

    if (window.loadRoster) {
      window.loadRoster().then(function (data) {
        ROSTER = data;
        renderHero();
        renderPeople();
      }).catch(function (err) {
        console.warn('Could not load live roster from Google Sheet, using placeholder data.', err);
      });
    }

    if (window.loadPublications) {
      window.loadPublications().then(function (data) {
        PUBS = data;
        state.filterIdx = 0;
        state.expanded = false;
        renderHero();
        renderResearch();
      }).catch(function (err) {
        console.warn('Could not load live publications from Google Sheet, using placeholder data.', err);
      });
    }

    if (window.loadBoardManifest) {
      window.loadBoardManifest().then(function (posts) {
        BOARD_POSTS = posts;
        renderBoard();
      }).catch(function (err) {
        console.warn('Could not load board manifest.', err);
        BOARD_POSTS = [];
        renderBoard();
      });
    }
  });
})();
