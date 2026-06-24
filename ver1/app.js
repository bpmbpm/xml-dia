(function () {
  'use strict';

  const examples = [
    { title: 'BPMN простой', path: 'dia/bpmn-simple.bpmn' },
    { title: 'BPMN сложный', path: 'dia/bpmn-complex.bpmn' },
    { title: 'draw.io простой', path: 'dia/drawio-simple.drawio' },
    { title: 'draw.io сложный', path: 'dia/drawio-complex.drawio' },
    { title: 'Archi простой', path: 'dia/archi-simple.xml' },
    { title: 'Archi сложный', path: 'dia/archi-complex.xml' }
  ];

  let editor;
  let bpmnViewer;
  let currentZoom = 1;
  let currentPan = { x: 0, y: 0 };

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

  function xmlText(node, selector, fallback) {
    const found = node.querySelector(selector);
    return found ? (found.getAttribute('name') || found.getAttribute('identifier') || found.textContent || fallback) : fallback;
  }

  function renderFallback(format, doc) {
    clearDiagram();
    const nodes = Array.from(doc.querySelectorAll('mxCell[vertex="1"], element, relationship, folder, child')).slice(0, 36);
    const width = 1200;
    const height = Math.max(520, Math.ceil(nodes.length / 4) * 150 + 80);
    const cards = nodes.map((node, index) => {
      const x = 70 + (index % 4) * 270;
      const y = 70 + Math.floor(index / 4) * 150;
      const title = node.getAttribute('value') || node.getAttribute('name') || node.getAttribute('identifier') || node.getAttribute('id') || node.localName;
      return `<g transform="translate(${x},${y})">
        <rect width="210" height="78" rx="6" fill="#ffffff" stroke="#146c94" stroke-width="2"></rect>
        <text x="105" y="33" text-anchor="middle" font-size="14" font-family="Arial" fill="#1f2933">${escapeHtml(title).slice(0, 34)}</text>
        <text x="105" y="56" text-anchor="middle" font-size="12" font-family="Arial" fill="#5b6876">${escapeHtml(node.localName)}</text>
      </g>`;
    }).join('');
    byId('diagramCanvas').innerHTML = `<svg class="fallback-diagram" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${height}" fill="#f8fafc"></rect>
      <text x="40" y="38" font-size="22" font-family="Arial" fill="#1f2933">${format.label}</text>
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
    const response = await fetch(path);
    const xml = await response.text();
    setXml(xml);
    log(`Загружен пример: ${path}`);
    await renderDiagram();
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
  }

  async function init() {
    initEditor();
    initExamples();
    bindEvents();
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
    detectFormat,
    parseXml,
    renderDiagram,
    loadExample,
    getXml,
    setXml
  };

  document.addEventListener('DOMContentLoaded', init);
}());
