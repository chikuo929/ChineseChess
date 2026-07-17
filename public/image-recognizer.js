(function () {
  "use strict";

  const MANIFEST_URL = "/assets/piece-templates/manifest.json";
  const MAX_IMAGE_DIMENSION = 1800;
  const OPENCV_TIMEOUT_MS = 30000;
  const PIECE_LIMITS = {
    car: 2,
    horse: 2,
    elephant: 2,
    advisor: 2,
    general: 1,
    cannon: 2,
    soldier: 5
  };

  let manifestPromise = null;
  let templateCache = null;

  window.XiangqiImageRecognizer = {
    recognize
  };

  async function recognize(file) {
    if (!(file instanceof File) || !file.type.startsWith("image/")) {
      throw new Error("请选择 PNG、JPG 或 WebP 图片。");
    }

    const [cv, manifest, image] = await Promise.all([
      waitForOpenCv(),
      loadManifest(),
      loadFileImage(file)
    ]);
    const canvas = imageToCanvas(image);
    const source = cv.imread(canvas);
    let normalizedBoard = null;

    try {
      const boardRect = detectBoardRect(cv, source, manifest.canonicalBoard.aspectRatio);
      normalizedBoard = cropAndNormalizeBoard(cv, source, boardRect, manifest.canonicalBoard);
      const templates = await loadTemplates(cv, manifest);
      const squares = recognizeSquares(cv, normalizedBoard, manifest, templates);
      const pieces = assignPieceKinds(squares);

      if (pieces.length < 2 || !pieces.some((piece) => piece.side === "red") || !pieces.some((piece) => piece.side === "black")) {
        throw new Error("没有识别到完整局面，请确认棋盘和棋子都清晰可见。");
      }

      const bottomSide = detectBottomSide(pieces);
      const canonicalPieces = pieces.map((piece) => {
        if (bottomSide === "black") {
          return { ...piece, x: 8 - piece.x, y: 9 - piece.y };
        }
        return piece;
      });

      return {
        pieces: canonicalPieces.map(({ side, kind, x, y }) => ({ side, kind, x, y })),
        bottomSide
      };
    } finally {
      source.delete();
      normalizedBoard?.delete();
    }
  }

  async function waitForOpenCv() {
    const startedAt = Date.now();

    while (!window.cv && Date.now() - startedAt < OPENCV_TIMEOUT_MS) {
      await delay(80);
    }

    if (!window.cv) throw new Error("图片识别组件加载失败，请刷新页面后重试。");

    let cv = window.cv;
    if (typeof cv.then === "function") {
      cv = await Promise.race([
        cv,
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error("图片识别组件加载超时，请刷新页面后重试。")), OPENCV_TIMEOUT_MS);
        })
      ]);
    }

    while (!cv?.Mat && Date.now() - startedAt < OPENCV_TIMEOUT_MS) {
      await delay(80);
      cv = window.cv;
    }

    if (!cv?.Mat) throw new Error("图片识别组件尚未就绪，请稍后重试。");
    return cv;
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function loadManifest() {
    if (!manifestPromise) {
      manifestPromise = fetch(MANIFEST_URL, { cache: "force-cache" }).then((response) => {
        if (!response.ok) throw new Error("棋子模板加载失败，请刷新页面后重试。");
        return response.json();
      });
    }
    return manifestPromise;
  }

  function loadFileImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("图片读取失败，请换一张图片重试。"));
      };
      image.src = url;
    });
  }

  function loadRemoteImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("棋子模板加载失败，请刷新页面后重试。"));
      image.src = url;
    });
  }

  function imageToCanvas(image) {
    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext("2d", { willReadFrequently: true }).drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function detectBoardRect(cv, source, expectedAspect) {
    const gray = new cv.Mat();
    const blurred = new cv.Mat();
    const edges = new cv.Mat();
    const closed = new cv.Mat();
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    const kernelSize = Math.max(5, Math.round(Math.min(source.cols, source.rows) / 150) | 1);
    const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(kernelSize, kernelSize));
    let best = null;

    try {
      cv.cvtColor(source, gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
      cv.Canny(blurred, edges, 45, 130);
      cv.morphologyEx(edges, closed, cv.MORPH_CLOSE, kernel, new cv.Point(-1, -1), 2);
      cv.findContours(closed, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

      const imageArea = source.cols * source.rows;

      for (let index = 0; index < contours.size(); index += 1) {
        const contour = contours.get(index);
        const rect = cv.boundingRect(contour);
        const rectArea = rect.width * rect.height;
        const areaRatio = rectArea / imageArea;
        const aspect = rect.width / rect.height;
        const contourArea = Math.abs(cv.contourArea(contour));
        contour.delete();

        if (rect.width < 220 || rect.height < 260 || areaRatio < 0.08 || aspect < 0.76 || aspect > 1.04) continue;

        const aspectScore = Math.max(0.2, 1 - Math.abs(aspect - expectedAspect) / 0.22);
        const fillScore = Math.min(1, contourArea / Math.max(1, rectArea));
        const score = rectArea * aspectScore * (0.72 + fillScore * 0.28);

        if (!best || score > best.score) best = { ...rect, score };
      }

      if (!best) {
        const sourceAspect = source.cols / source.rows;
        if (sourceAspect >= 0.78 && sourceAspect <= 1.02) {
          return { x: 0, y: 0, width: source.cols, height: source.rows };
        }
        throw new Error("没有找到完整棋盘，请上传包含整个棋盘的清晰截图。");
      }

      return fitRectToAspect(best, expectedAspect, source.cols, source.rows);
    } finally {
      gray.delete();
      blurred.delete();
      edges.delete();
      closed.delete();
      contours.delete();
      hierarchy.delete();
      kernel.delete();
    }
  }

  function fitRectToAspect(rect, expectedAspect, imageWidth, imageHeight) {
    let width = rect.width;
    let height = rect.height;
    const centerX = rect.x + width / 2;
    const centerY = rect.y + height / 2;

    if (width / height < expectedAspect) {
      width = height * expectedAspect;
    } else {
      height = width / expectedAspect;
    }

    width = Math.min(width, imageWidth);
    height = Math.min(height, imageHeight);
    const x = Math.max(0, Math.min(imageWidth - width, centerX - width / 2));
    const y = Math.max(0, Math.min(imageHeight - height, centerY - height / 2));

    return {
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(width),
      height: Math.round(height)
    };
  }

  function cropAndNormalizeBoard(cv, source, rect, canonicalBoard) {
    const safeRect = new cv.Rect(
      Math.max(0, rect.x),
      Math.max(0, rect.y),
      Math.min(source.cols - Math.max(0, rect.x), rect.width),
      Math.min(source.rows - Math.max(0, rect.y), rect.height)
    );
    const board = source.roi(safeRect);
    const normalized = new cv.Mat();

    try {
      cv.resize(
        board,
        normalized,
        new cv.Size(canonicalBoard.width, canonicalBoard.height),
        0,
        0,
        cv.INTER_AREA
      );
      return normalized;
    } finally {
      board.delete();
    }
  }

  async function loadTemplates(cv, manifest) {
    if (templateCache) return templateCache;

    const loaded = await Promise.all(manifest.templates.map(async (template) => {
      const image = await loadRemoteImage(`/assets/piece-templates/${template.file}`);
      const rgba = cv.imread(image);
      const gray = new cv.Mat();
      const binary = new cv.Mat();

      try {
        cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
        cv.threshold(gray, binary, 127, 255, cv.THRESH_BINARY);
        return { side: template.side, kind: template.kind, mat: binary };
      } finally {
        rgba.delete();
        gray.delete();
      }
    }));

    templateCache = loaded;
    return loaded;
  }

  function recognizeSquares(cv, board, manifest, templates) {
    const squares = [];
    const searchSize = manifest.templateSize + 16;
    const half = searchSize / 2;

    for (let y = 0; y < 10; y += 1) {
      for (let x = 0; x < 9; x += 1) {
        const centerX = Math.round(manifest.grid.left + x * manifest.grid.stepX);
        const centerY = Math.round(manifest.grid.top + y * manifest.grid.stepY);
        const rect = new cv.Rect(
          Math.round(centerX - half),
          Math.round(centerY - half),
          searchSize,
          searchSize
        );
        const patchView = board.roi(rect);
        const patch = patchView.clone();
        patchView.delete();
        const masks = createGlyphMasks(cv, patch, manifest.templateSize);
        try {
          let side = null;
          let mask = null;

          if (masks.redCount >= 150 && masks.redCount >= masks.blackCount * 0.7) {
            side = "red";
            mask = masks.red;
          } else if (masks.blackCount >= 120) {
            side = "black";
            mask = masks.black;
          }

          if (!side) continue;

          const scores = matchKinds(cv, mask, templates.filter((template) => template.side === side));
          squares.push({ side, x, y, scores });
        } finally {
          patch.delete();
          masks.red.delete();
          masks.black.delete();
        }
      }
    }

    return squares;
  }

  function createGlyphMasks(cv, patch, templateSize) {
    const red = cv.Mat.zeros(patch.rows, patch.cols, cv.CV_8UC1);
    const black = cv.Mat.zeros(patch.rows, patch.cols, cv.CV_8UC1);
    const centerX = (patch.cols - 1) / 2;
    const centerY = (patch.rows - 1) / 2;
    const radiusSquared = (templateSize * 0.45) ** 2;
    let redCount = 0;
    let blackCount = 0;

    for (let y = 0; y < patch.rows; y += 1) {
      for (let x = 0; x < patch.cols; x += 1) {
        if ((x - centerX) ** 2 + (y - centerY) ** 2 > radiusSquared) continue;
        const pixel = patch.ucharPtr(y, x);
        const redValue = pixel[0];
        const greenValue = pixel[1];
        const blueValue = pixel[2];
        const redGlyph = redValue > 75
          && redValue < 205
          && greenValue < 105
          && blueValue < 100
          && redValue - greenValue > 32
          && redValue - blueValue > 28;
        const blackGlyph = redValue < 95
          && greenValue < 105
          && blueValue < 110
          && redValue + greenValue + blueValue < 260;

        if (redGlyph) {
          red.ucharPtr(y, x)[0] = 255;
          redCount += 1;
        }
        if (blackGlyph) {
          black.ucharPtr(y, x)[0] = 255;
          blackCount += 1;
        }
      }
    }

    return { red, black, redCount, blackCount };
  }

  function matchKinds(cv, mask, templates) {
    const bestByKind = new Map();

    templates.forEach((template) => {
      const result = new cv.Mat();
      try {
        cv.matchTemplate(mask, template.mat, result, cv.TM_CCOEFF_NORMED);
        const score = cv.minMaxLoc(result).maxVal;
        if (!bestByKind.has(template.kind) || score > bestByKind.get(template.kind)) {
          bestByKind.set(template.kind, score);
        }
      } finally {
        result.delete();
      }
    });

    return [...bestByKind.entries()]
      .map(([kind, score]) => ({ kind, score }))
      .sort((a, b) => b.score - a.score);
  }

  function assignPieceKinds(squares) {
    const pieces = [];

    ["red", "black"].forEach((side) => {
      const remaining = { ...PIECE_LIMITS };
      const candidates = squares
        .filter((square) => square.side === side)
        .sort((a, b) => confidenceGap(b.scores) - confidenceGap(a.scores));

      candidates.forEach((candidate) => {
        const choice = candidate.scores.find((item) => remaining[item.kind] > 0);
        if (!choice) return;
        remaining[choice.kind] -= 1;
        pieces.push({
          side,
          kind: choice.kind,
          x: candidate.x,
          y: candidate.y,
          score: choice.score
        });
      });
    });

    return pieces;
  }

  function confidenceGap(scores) {
    if (!scores.length) return -1;
    return scores[0].score - (scores[1]?.score ?? 0);
  }

  function detectBottomSide(pieces) {
    const redGeneral = pieces.find((piece) => piece.side === "red" && piece.kind === "general");
    const blackGeneral = pieces.find((piece) => piece.side === "black" && piece.kind === "general");

    if (redGeneral && blackGeneral) return redGeneral.y > blackGeneral.y ? "red" : "black";
    if (redGeneral) return redGeneral.y >= 5 ? "red" : "black";
    if (blackGeneral) return blackGeneral.y >= 5 ? "black" : "red";

    const redAverage = averageY(pieces.filter((piece) => piece.side === "red"));
    const blackAverage = averageY(pieces.filter((piece) => piece.side === "black"));
    return redAverage > blackAverage ? "red" : "black";
  }

  function averageY(pieces) {
    return pieces.reduce((total, piece) => total + piece.y, 0) / Math.max(1, pieces.length);
  }
}());
