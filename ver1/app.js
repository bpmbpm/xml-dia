(function () {
  'use strict';

  const examples = [
    { title: 'BPMN простой', path: 'dia/bpmn-simple.bpmn' },
    { title: 'BPMN сложный', path: 'dia/bpmn-complex.bpmn' },
    { title: 'BPMN сложный2', path: 'dia/bpmn-complex2.bpmn' },
    { title: 'draw.io простой', path: 'dia/drawio-simple.drawio' },
    { title: 'draw.io сложный', path: 'dia/drawio-complex.drawio' },
    { title: 'draw.io сложный2', path: 'dia/drawio-complex2.drawio' },
    { title: 'Archi простой', path: 'dia/archi-simple.xml' },
    { title: 'Archi сложный', path: 'dia/archi-complex.xml' },
    { title: 'Archi сложный2', path: 'dia/archi-complex2.xml' }
  ];

  let editor;
  let bpmnViewer;
  let currentZoom = 1;
  let currentPan = { x: 0, y: 0 };
  let currentXmlMark = null;
  let currentContextKey = null;

  function byId(id) {
    return document.getElementById(id);
  }

  function log(message, level) {
    const output = byId('logOutput');
    const time = new Date().toLocaleTimeString('ru-RU');
    output.textContent += `[${time}] ${level || 'info'}: ${message}\n`;
    output.scrollTop = output.scrollHeight;
  }

  function getXml() {
    return editor ? editor.getValue() : byId('xmlEditor').value;
  }

  function setXml(xml) {
    if (editor) {
      editor.setValue(xml);
    } else {
      byId('xmlEditor').value = xml;
    }
  }

  function parseXml(xml) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const parserError = doc.querySelector('parsererror');
    if (parserError) {
      throw new Error(parserError.textContent.trim().replace(/\s+/g, ' '));
    }
    return doc;
  }

  function detectFormat(xml) {
    const doc = parseXml(xml);
    const root = doc.documentElement;
    const rootName = root.localName.toLowerCase();
    const ns = root.namespaceURI || '';

    if (rootName === 'definitions' && (ns.indexOf('bpmn') !== -1 || root.prefix === 'bpmn')) {
      return { name: 'bpmn', label: 'BPMN 2.0', doc };
    }
    if (rootName === 'mxfile' || rootName === 'mxgraphmodel') {
      return { name: 'drawio', label: 'draw.io', doc };
    }
    if (rootName === 'model' && (ns.indexOf('archimate') !== -1 || root.getAttribute('identifier'))) {
      return { name: 'archi', label: 'ArchiMate', doc };
    }
    throw new Error(`Формат не распознан: корневой элемент <${root.nodeName}>.`);
  }

  function clearDiagram() {
    const canvas = byId('diagramCanvas');
    canvas.innerHTML = '';
    if (bpmnViewer) {
      bpmnViewer.destroy();
      bpmnViewer = null;
    }
  }

  async function renderBpmn(xml) {
    clearDiagram();
    bpmnViewer = new BpmnJS({ container: '#diagramCanvas' });
    await bpmnViewer.importXML(xml);
    bpmnViewer.get('canvas').zoom('fit-viewport');
  }

  function stripHtml(value) {
    return String(value || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  }

  function nodeKey(node) {
    return node.getAttribute('id') || node.getAttribute('identifier') || '';
  }

  function nodeTitle(node) {
    return stripHtml(node.getAttribute('value') || node.getAttribute('name') || node.getAttribute('identifier') || node.getAttribute('id') || node.localName);
  }

  function nodeType(node) {
    return node.getAttribute('xsi:type') || node.getAttributeNS('http://www.w3.org/2001/XMLSchema-instance', 'type') || node.localName;
  }

  function numberAttribute(node, name, fallback) {
    if (!node || !node.hasAttribute(name)) {
      return fallback;
    }
    const value = parseFloat(node.getAttribute(name));
    return Number.isFinite(value) ? value : fallback;
  }

  function readDrawioGeometry(node, index) {
    const geometry = node.querySelector('mxGeometry');
    const gridX = 70 + (index % 4) * 260;
    const gridY = 80 + Math.floor(index / 4) * 140;
    return {
      x: numberAttribute(geometry, 'x', gridX),
      y: numberAttribute(geometry, 'y', gridY),
      width: numberAttribute(geometry, 'width', 180),
      height: numberAttribute(geometry, 'height', 70)
    };
  }

  function gridGeometry(index) {
    return {
      x: 70 + (index % 4) * 260,
      y: 90 + Math.floor(index / 4) * 150,
      width: 190,
      height: 76
    };
  }

  function buildFallbackGraph(format, doc) {
    let xmlNodes = [];
    let xmlEdges = [];

    if (format.name === 'drawio') {
      xmlNodes = Array.from(doc.querySelectorAll('mxCell[vertex="1"]'));
      xmlEdges = Array.from(doc.querySelectorAll('mxCell[edge="1"][source][target]'));
    } else if (format.name === 'archi') {
      xmlNodes = Array.from(doc.querySelectorAll('element'));
      xmlEdges = Array.from(doc.querySelectorAll('relationship[source][target]'));
    } else if (format.name === 'bpmn') {
      xmlNodes = Array.from(doc.querySelectorAll('process > *[id], collaboration > *[id]')).filter((node) => node.localName !== 'sequenceFlow');
      xmlEdges = Array.from(doc.querySelectorAll('sequenceFlow[sourceRef][targetRef]'));
    } else {
      xmlNodes = Array.from(doc.querySelectorAll('[id], [identifier]')).slice(0, 36);
    }

    const nodes = xmlNodes.slice(0, 48).map((node, index) => {
      const geometry = format.name === 'drawio' ? readDrawioGeometry(node, index) : gridGeometry(index);
      return {
        key: nodeKey(node),
        title: nodeTitle(node),
        type: nodeType(node),
        x: geometry.x,
        y: geometry.y,
        width: geometry.width,
        height: geometry.height
      };
    }).filter((node) => node.key);

    const nodeByKey = new Map(nodes.map((node) => [node.key, node]));
    const edges = xmlEdges.map((edge) => {
      const source = edge.getAttribute('source') || edge.getAttribute('sourceRef');
      const target = edge.getAttribute('target') || edge.getAttribute('targetRef');
      return {
        key: nodeKey(edge),
        title: nodeTitle(edge),
        type: nodeType(edge),
        source,
        target
      };
    }).filter((edge) => edge.key && nodeByKey.has(edge.source) && nodeByKey.has(edge.target));

    return { nodes, edges, nodeByKey };
  }

  function renderFallback(format, doc) {
    clearDiagram();
    const graph = buildFallbackGraph(format, doc);
    const width = Math.max(900, ...graph.nodes.map((node) => node.x + node.width + 90), 900);
    const height = Math.max(520, ...graph.nodes.map((node) => node.y + node.height + 90), 520);
    const connectors = graph.edges.map((edge) => {
      const source = graph.nodeByKey.get(edge.source);
      const target = graph.nodeByKey.get(edge.target);
      const x1 = source.x + source.width;
      const y1 = source.y + source.height / 2;
      const x2 = target.x;
      const y2 = target.y + target.height / 2;
      const labelX = (x1 + x2) / 2;
      const labelY = (y1 + y2) / 2 - 8;
      return `<g class="diagram-element diagram-edge" data-xml-key="${escapeHtml(edge.key)}" role="button" tabindex="0">
        <line class="diagram-connector-hit" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"></line>
        <line class="diagram-connector" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" marker-end="url(#diagramArrow)"></line>
        ${edge.title ? `<text x="${labelX}" y="${labelY}" text-anchor="middle" font-size="12" font-family="Arial" fill="#5b6876">${escapeHtml(edge.title).slice(0, 26)}</text>` : ''}
      </g>`;
    }).join('');
    const cards = graph.nodes.map((node) => `<g class="diagram-element diagram-node" data-xml-key="${escapeHtml(node.key)}" transform="translate(${node.x},${node.y})" role="button" tabindex="0">
        <rect width="${node.width}" height="${node.height}" rx="6"></rect>
        <text x="${node.width / 2}" y="${Math.max(30, node.height / 2 - 5)}" text-anchor="middle" font-size="14" font-family="Arial">${escapeHtml(node.title).slice(0, 34)}</text>
        <text x="${node.width / 2}" y="${Math.max(52, node.height / 2 + 18)}" text-anchor="middle" font-size="12" font-family="Arial">${escapeHtml(node.type).slice(0, 30)}</text>
      </g>`).join('');
    byId('diagramCanvas').innerHTML = `<svg class="fallback-diagram" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <marker id="diagramArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z"></path>
        </marker>
      </defs>
      <rect width="${width}" height="${height}" fill="#f8fafc"></rect>
      <text x="40" y="38" font-size="22" font-family="Arial" fill="#1f2933">${format.label}</text>
      ${connectors}
      ${cards || `<text x="40" y="90" font-size="16" font-family="Arial" fill="#a93131">Нет элементов для отображения</text>`}
    </svg>`;
    applySvgTransform();
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[char]));
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function escapeXmlAttribute(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&apos;'
    }[char]));
  }

  function cssValue(value) {
    if (window.CSS && window.CSS.escape) {
      return window.CSS.escape(value);
    }
    return String(value).replace(/["\\]/g, '\\$&');
  }

  function findXmlElementRange(xml, key) {
    const attrPattern = new RegExp(`\\b(?:id|identifier)\\s*=\\s*(['"])${escapeRegExp(key)}\\1`, 'g');
    let match = attrPattern.exec(xml);
    while (match) {
      const start = xml.lastIndexOf('<', match.index);
      const tagEnd = xml.indexOf('>', match.index);
      if (start !== -1 && tagEnd !== -1 && xml[start + 1] !== '/') {
        const openTag = xml.slice(start, tagEnd + 1);
        const tagNameMatch = openTag.match(/^<\s*([^\s/>]+)/);
        if (tagNameMatch) {
          const tagName = tagNameMatch[1];
          let end = tagEnd + 1;
          if (!/\/\s*>$/.test(openTag)) {
            const closePattern = new RegExp(`</\\s*${escapeRegExp(tagName)}\\s*>`, 'i');
            const closeMatch = closePattern.exec(xml.slice(tagEnd + 1));
            if (closeMatch) {
              end = tagEnd + 1 + closeMatch.index + closeMatch[0].length;
            }
          }
          return { start, end };
        }
      }
      match = attrPattern.exec(xml);
    }
    return null;
  }

  function findXmlElementNode(doc, key) {
    return Array.from(doc.getElementsByTagName('*')).find((node) => node.getAttribute('id') === key || node.getAttribute('identifier') === key) || null;
  }

  function labelAttributeName(node) {
    if (node.localName === 'mxCell') {
      return 'value';
    }
    if (node.hasAttribute('value') && !node.hasAttribute('name')) {
      return 'value';
    }
    return 'name';
  }

  function renameXmlLabel(xml, key, label) {
    const doc = parseXml(xml);
    const node = findXmlElementNode(doc, key);
    if (!node) {
      throw new Error(`Элемент ${key} не найден в XML.`);
    }
    const range = findXmlElementRange(xml, key);
    if (!range) {
      throw new Error(`Блок XML для ${key} не найден.`);
    }
    const attrName = labelAttributeName(node);
    const tagEnd = xml.indexOf('>', range.start);
    const openTag = xml.slice(range.start, tagEnd + 1);
    const escapedLabel = escapeXmlAttribute(label);
    const attrPattern = new RegExp(`(\\s${escapeRegExp(attrName)}\\s*=\\s*)(['"])([\\s\\S]*?)\\2`);
    let nextOpenTag;
    if (attrPattern.test(openTag)) {
      nextOpenTag = openTag.replace(attrPattern, (full, prefix) => `${prefix}"${escapedLabel}"`);
    } else if (/\/\s*>$/.test(openTag)) {
      nextOpenTag = openTag.replace(/\s*\/>$/, ` ${attrName}="${escapedLabel}"/>`);
    } else {
      nextOpenTag = openTag.replace(/\s*>$/, ` ${attrName}="${escapedLabel}">`);
    }
    return xml.slice(0, range.start) + nextOpenTag + xml.slice(tagEnd + 1);
  }

  function indexToEditorPos(text, index) {
    const lines = text.slice(0, index).split('\n');
    return {
      line: lines.length - 1,
      ch: lines[lines.length - 1].length
    };
  }

  function highlightXmlRange(range) {
    const xml = getXml();
    if (currentXmlMark) {
      currentXmlMark.clear();
      currentXmlMark = null;
    }
    if (editor) {
      const from = indexToEditorPos(xml, range.start);
      const to = indexToEditorPos(xml, range.end);
      editor.focus();
      editor.setSelection(from, to);
      editor.scrollIntoView({ from, to }, 80);
      currentXmlMark = editor.markText(from, to, { className: 'xml-code-highlight' });
      return;
    }
    const textarea = byId('xmlEditor');
    textarea.focus();
    textarea.setSelectionRange(range.start, range.end);
  }

  function selectedLabelForKey(key) {
    try {
      const node = findXmlElementNode(parseXml(getXml()), key);
      return node ? nodeTitle(node) : '';
    } catch (error) {
      return '';
    }
  }

  function selectDiagramElement(key) {
    const canvas = byId('diagramCanvas');
    canvas.querySelectorAll('.is-selected').forEach((node) => node.classList.remove('is-selected'));
    const escaped = cssValue(key);
    canvas.querySelectorAll(`[data-xml-key="${escaped}"], [data-element-id="${escaped}"]`).forEach((node) => node.classList.add('is-selected'));
  }

  function showXmlCodeForKey(key) {
    const range = findXmlElementRange(getXml(), key);
    if (!range) {
      log(`Блок XML для элемента ${key} не найден`, 'error');
      return false;
    }
    highlightXmlRange(range);
    selectDiagramElement(key);
    log(`Показан код элемента: ${key}`);
    return true;
  }

  async function renderDiagram() {
    const xml = getXml();
    try {
      const format = detectFormat(xml);
      log(`Определен формат: ${format.label}`);
      if (format.name === 'bpmn' && window.BpmnJS) {
        await renderBpmn(xml);
      } else {
        renderFallback(format, format.doc);
      }
      log('Диаграмма построена');
    } catch (error) {
      clearDiagram();
      byId('diagramCanvas').innerHTML = `<div class="error-text">${escapeHtml(error.message)}</div>`;
      log(error.message, 'error');
    }
  }

  function applySvgTransform() {
    const svg = byId('diagramCanvas').querySelector('svg');
    if (svg) {
      svg.style.transformOrigin = '0 0';
      svg.style.transform = `translate(${currentPan.x}px, ${currentPan.y}px) scale(${currentZoom})`;
    }
  }

  function changeZoom(delta) {
    currentZoom = Math.max(0.2, Math.min(4, currentZoom + delta));
    byId('zoomResetButton').textContent = `${Math.round(currentZoom * 100)}%`;
    if (bpmnViewer) {
      bpmnViewer.get('canvas').zoom(currentZoom);
    } else {
      applySvgTransform();
    }
  }

  function resetZoom() {
    currentZoom = 1;
    currentPan = { x: 0, y: 0 };
    byId('zoomResetButton').textContent = '100%';
    if (bpmnViewer) {
      bpmnViewer.get('canvas').zoom('fit-viewport');
    } else {
      applySvgTransform();
    }
  }

  function pan(dx, dy) {
    if (bpmnViewer) {
      bpmnViewer.get('canvas').scroll({ dx: -dx, dy: -dy });
    } else {
      currentPan.x += dx;
      currentPan.y += dy;
      applySvgTransform();
    }
  }

  async function loadExample(path) {
    try {
      const response = await fetch(path);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
      }
      const xml = await response.text();
      setXml(xml);
      log(`Загружен пример: ${path}`);
      await renderDiagram();
      return true;
    } catch (error) {
      log(`Не удалось загрузить пример ${path}: ${error.message}. При запуске через file:// браузер может блокировать чтение файлов из папки dia.`, 'error');
      return false;
    }
  }

  function saveText(filename, text, type) {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  function exportSvg() {
    const svg = byId('diagramCanvas').querySelector('svg');
    if (!svg) {
      log('SVG экспорт доступен после построения SVG-диаграммы', 'error');
      return;
    }
    saveText('diagram.svg', new XMLSerializer().serializeToString(svg), 'image/svg+xml');
    log('SVG сохранен');
  }

  function exportPng() {
    const svg = byId('diagramCanvas').querySelector('svg');
    if (!svg) {
      log('PNG экспорт доступен для SVG-диаграмм', 'error');
      return;
    }
    const svgText = new XMLSerializer().serializeToString(svg);
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = image.width || 1200;
      canvas.height = image.height || 800;
      canvas.getContext('2d').drawImage(image, 0, 0);
      canvas.toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'diagram.png';
        link.click();
        URL.revokeObjectURL(url);
      });
    };
    image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
    log('PNG подготовлен');
  }

  function exportPdf() {
    const popup = window.open('', '_blank');
    popup.document.write(`<pre>${escapeHtml(getXml())}</pre><script>window.print();<\/script>`);
    popup.document.close();
    log('PDF создается через печать браузера');
  }

  async function copyCurrentUrl() {
    const url = new URL(location.href);
    url.searchParams.set('xml', btoa(unescape(encodeURIComponent(getXml()))));
    await navigator.clipboard.writeText(url.toString());
    log('URL скопирован в буфер обмена');
  }

  function openExternalViewer() {
    const xml = encodeURIComponent(getXml());
    const target = byId('externalViewerSelect').value;
    const urls = {
      'bpmn-io': `https://demo.bpmn.io/s/new?diagram=${xml}`,
      afomi: `https://afomi.github.io/bpmn-viewer/?diagram=${xml}`,
      drawio: `https://app.diagrams.net/?title=diagram.drawio#R${xml}`
    };
    window.open(urls[target], '_blank');
    log(`Открыт внешний viewer: ${target}`);
  }

  function undoEditor() {
    if (editor) {
      editor.undo();
      editor.focus();
      return;
    }
    byId('xmlEditor').focus();
    document.execCommand('undo');
  }

  function redoEditor() {
    if (editor) {
      editor.redo();
      editor.focus();
      return;
    }
    byId('xmlEditor').focus();
    document.execCommand('redo');
  }

  function diagramElementKeyFromEvent(event) {
    const canvas = byId('diagramCanvas');
    const fallbackElement = event.target.closest('[data-xml-key]');
    if (fallbackElement && canvas.contains(fallbackElement)) {
      return fallbackElement.getAttribute('data-xml-key');
    }
    const bpmnElement = event.target.closest('[data-element-id]');
    if (bpmnElement && canvas.contains(bpmnElement)) {
      return bpmnElement.getAttribute('data-element-id');
    }
    return '';
  }

  async function renameDiagramElement(key, label) {
    try {
      const nextXml = renameXmlLabel(getXml(), key, label);
      setXml(nextXml);
      log(`Название элемента ${key} изменено`);
      await renderDiagram();
      showXmlCodeForKey(key);
    } catch (error) {
      log(error.message, 'error');
    }
  }

  function hideContextMenu() {
    const menu = byId('diagramContextMenu');
    menu.hidden = true;
    menu.textContent = '';
    currentContextKey = null;
  }

  function showRenameInput() {
    const menu = byId('diagramContextMenu');
    const key = currentContextKey;
    if (!key) {
      hideContextMenu();
      return;
    }
    menu.textContent = '';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = selectedLabelForKey(key);
    input.setAttribute('aria-label', 'Новое название элемента');
    menu.appendChild(input);
    input.focus();
    input.select();
    input.addEventListener('keydown', async (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        const label = input.value.trim();
        hideContextMenu();
        if (label) {
          await renameDiagramElement(key, label);
        }
      }
      if (event.key === 'Escape') {
        hideContextMenu();
      }
    });
  }

  function openContextMenu(key, x, y) {
    const menu = byId('diagramContextMenu');
    currentContextKey = key;
    menu.textContent = '';

    const showCodeButton = document.createElement('button');
    showCodeButton.type = 'button';
    showCodeButton.textContent = 'Показать код';
    showCodeButton.addEventListener('click', (event) => {
      event.stopPropagation();
      showXmlCodeForKey(key);
      hideContextMenu();
    });

    const renameButton = document.createElement('button');
    renameButton.type = 'button';
    renameButton.textContent = 'Изменить название';
    renameButton.addEventListener('click', (event) => {
      event.stopPropagation();
      showRenameInput();
    });

    menu.append(showCodeButton, renameButton);
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.hidden = false;
  }

  function bindDiagramInteractions() {
    const canvas = byId('diagramCanvas');
    canvas.addEventListener('click', (event) => {
      const key = diagramElementKeyFromEvent(event);
      if (key) {
        showXmlCodeForKey(key);
      }
    });
    canvas.addEventListener('contextmenu', (event) => {
      const key = diagramElementKeyFromEvent(event);
      if (!key) {
        return;
      }
      event.preventDefault();
      selectDiagramElement(key);
      openContextMenu(key, event.clientX, event.clientY);
    });
    canvas.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }
      const key = diagramElementKeyFromEvent(event);
      if (key) {
        event.preventDefault();
        showXmlCodeForKey(key);
      }
    });
    document.addEventListener('click', (event) => {
      const menu = byId('diagramContextMenu');
      if (!menu.hidden && !menu.contains(event.target)) {
        hideContextMenu();
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        hideContextMenu();
      }
    });
  }

  function refreshEditor() {
    if (editor) {
      editor.refresh();
    }
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function initSplitters() {
    const workspace = byId('workspace');
    const workspaceSplitter = byId('workspaceSplitter');
    const logSplitter = byId('logSplitter');
    if (!workspace || !workspaceSplitter || !logSplitter) {
      return;
    }

    workspaceSplitter.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      workspaceSplitter.setPointerCapture(event.pointerId);
      document.body.classList.add('is-resizing');
      const move = (moveEvent) => {
        const rect = workspace.getBoundingClientRect();
        if (window.matchMedia('(max-width: 900px)').matches) {
          const height = clamp(moveEvent.clientY - rect.top, 220, rect.height - 260);
          workspace.style.setProperty('--editor-height', `${height}px`);
        } else {
          const width = clamp(moveEvent.clientX - rect.left, 280, rect.width - 320);
          workspace.style.setProperty('--editor-width', `${width}px`);
        }
        refreshEditor();
      };
      const up = () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        document.body.classList.remove('is-resizing');
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    });

    logSplitter.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      logSplitter.setPointerCapture(event.pointerId);
      document.body.classList.add('is-resizing');
      const move = (moveEvent) => {
        const height = clamp(window.innerHeight - moveEvent.clientY, 90, window.innerHeight - 320);
        document.documentElement.style.setProperty('--log-height', `${height}px`);
        refreshEditor();
      };
      const up = () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        document.body.classList.remove('is-resizing');
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    });
  }

  function loadFromUrl() {
    const params = new URLSearchParams(location.search);
    const encoded = params.get('xml');
    if (!encoded) {
      return false;
    }
    setXml(decodeURIComponent(escape(atob(encoded))));
    log('XML загружен из параметра url');
    return true;
  }

  function initEditor() {
    if (window.CodeMirror) {
      editor = CodeMirror.fromTextArea(byId('xmlEditor'), {
        mode: 'application/xml',
        lineNumbers: true,
        lineWrapping: true,
        extraKeys: {
          'Ctrl-F': 'findPersistent',
          'Ctrl-H': 'replace',
          'Cmd-F': 'findPersistent',
          'Cmd-Alt-F': 'replace'
        }
      });
      editor.on('change', () => {
        try {
          const format = detectFormat(getXml());
          log(`Автоопределение: ${format.label}`);
        } catch (error) {
          log(`Проверка XML: ${error.message}`, 'error');
        }
      });
    }
  }

  function initExamples() {
    const select = byId('exampleSelect');
    select.textContent = '';
    examples.forEach((item) => {
      const option = document.createElement('option');
      option.value = item.path;
      option.textContent = item.title;
      select.appendChild(option);
    });
    select.addEventListener('change', () => loadExample(select.value));
  }

  function bindEvents() {
    byId('renderButton').addEventListener('click', renderDiagram);
    byId('undoButton').addEventListener('click', undoEditor);
    byId('redoButton').addEventListener('click', redoEditor);
    byId('saveXmlButton').addEventListener('click', () => saveText('diagram.xml', getXml(), 'application/xml'));
    byId('copyUrlButton').addEventListener('click', copyCurrentUrl);
    byId('externalViewerButton').addEventListener('click', openExternalViewer);
    byId('exportSvgButton').addEventListener('click', exportSvg);
    byId('exportPngButton').addEventListener('click', exportPng);
    byId('exportPdfButton').addEventListener('click', exportPdf);
    byId('zoomOutButton').addEventListener('click', () => changeZoom(-0.1));
    byId('zoomInButton').addEventListener('click', () => changeZoom(0.1));
    byId('zoomResetButton').addEventListener('click', resetZoom);
    byId('fitButton').addEventListener('click', resetZoom);
    byId('panLeftButton').addEventListener('click', () => pan(-80, 0));
    byId('panRightButton').addEventListener('click', () => pan(80, 0));
    byId('panUpButton').addEventListener('click', () => pan(0, -80));
    byId('panDownButton').addEventListener('click', () => pan(0, 80));
    byId('fileInput').addEventListener('change', async (event) => {
      const file = event.target.files[0];
      if (!file) {
        return;
      }
      setXml(await file.text());
      log(`Файл загружен: ${file.name}`);
      renderDiagram();
    });
    bindDiagramInteractions();
  }

  async function init() {
    initEditor();
    initExamples();
    bindEvents();
    initSplitters();
    if (window.XmlDiaSkipAutoInit) {
      return;
    }
    if (!loadFromUrl()) {
      await loadExample(examples[0].path);
    } else {
      await renderDiagram();
    }
  }

  window.XmlDia = {
    examples,
    detectFormat,
    parseXml,
    renderFallback,
    renderDiagram,
    loadExample,
    findXmlElementRange,
    renameXmlLabel,
    showXmlCodeForKey,
    getXml,
    setXml
  };

  document.addEventListener('DOMContentLoaded', init);
}());
