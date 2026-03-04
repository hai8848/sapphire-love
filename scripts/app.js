(() => {
  const story = window.STORY_SCENES;
  if (!story) {
    console.error("未找到剧情配置 STORY_SCENES");
    return;
  }

  const appShell = document.querySelector(".app-shell");
  const scenePanel = document.getElementById("scenePanel");
  const sceneHero = document.getElementById("sceneHero");
  const sceneText = document.getElementById("sceneText");
  const choicesBox = document.getElementById("choices");
  const particlesRoot = document.getElementById("oceanParticles");

  const resolveAssetUrl = (assetPath) => {
    const normalized = assetPath.replace(/^\.?\//, "");

    if (window.location.hostname.endsWith("github.io")) {
      const pathParts = window.location.pathname.split("/").filter(Boolean);
      const repoName = pathParts[0] || "";
      return repoName ? `/${repoName}/${normalized}` : `/${normalized}`;
    }

    return `./${normalized}`;
  };

  const audioController =
    typeof window.createAudioController === "function"
      ? window.createAudioController(resolveAssetUrl("assets/bgm.m4a"))
      : { startFadeIn: () => undefined };

  const FADE_OUT_MS = 220;
  const FADE_IN_MS = 260;

  let currentSceneId = story.initialSceneId;
  let isTransitioning = false;

  const THEME_CONFIG = {
    default: {
      className: "theme-default",
      particleShape: "orb",
      particleCount: 42,
      particleMin: 10,
      particleMax: 26,
      durationMin: 8,
      durationRange: 8
    },
    shore: {
      className: "theme-shore",
      particleShape: "orb",
      particleCount: 58,
      particleMin: 16,
      particleMax: 42,
      durationMin: 9,
      durationRange: 7
    },
    rain: {
      className: "theme-rain",
      particleShape: "rain",
      particleCount: 82,
      particleMin: 2,
      particleMax: 5,
      durationMin: 2.2,
      durationRange: 1.6
    }
  };

  let currentThemeKey = "default";
  let torchStream = null;
  let torchTrack = null;
  let torchTimerId = null;
  let torchRetryTimerId = null;
  let torchUnavailable = false;
  let torchRequestInFlight = false;
  let imageCaptureController = null;
  let rearCameraDeviceId = "";
  let torchPreviewVideo = null;
  let systemCameraInput = null;

  const getScene = (sceneId) => story.sceneMap[sceneId];

  const setButtonsDisabled = (disabled) => {
    const buttons = choicesBox.querySelectorAll("button");
    buttons.forEach((button) => {
      button.disabled = disabled;
    });
  };

  const runAudioCue = (cue) => {
    if (cue === "startFadeIn") {
      audioController.startFadeIn({ duration: 9000, targetVolume: 0.4 });
    }
  };

  const TORCH_VIDEO_ATTEMPTS = [
    { facingMode: { exact: "environment" } },
    { facingMode: { ideal: "environment" } },
    { facingMode: "environment" },
    true
  ];

  const REAR_CAMERA_LABEL_RE = /(rear|back|environment|后|广角|主摄|wide|camera 0|cam0)/i;
  const FRONT_CAMERA_LABEL_RE = /(front|user|前|selfie)/i;

  const ensureTorchPreviewVideo = () => {
    if (torchPreviewVideo) {
      return torchPreviewVideo;
    }

    const video = document.createElement("video");
    video.setAttribute("playsinline", "true");
    video.muted = true;
    video.autoplay = true;
    video.style.position = "fixed";
    video.style.width = "1px";
    video.style.height = "1px";
    video.style.opacity = "0";
    video.style.pointerEvents = "none";
    video.style.left = "-9999px";
    video.style.top = "0";
    document.body.appendChild(video);
    torchPreviewVideo = video;
    return video;
  };

  const attachPreviewStream = async (stream) => {
    if (!stream) {
      return;
    }

    const video = ensureTorchPreviewVideo();
    if (video.srcObject !== stream) {
      video.srcObject = stream;
    }

    try {
      await video.play();
    } catch (error) {
      // some browsers reject hidden autoplay, torch may still work
    }
  };

  const detachPreviewStream = () => {
    if (!torchPreviewVideo) {
      return;
    }

    try {
      torchPreviewVideo.pause();
    } catch (error) {
      // ignore pause failures
    }

    torchPreviewVideo.srcObject = null;
  };

  const openSystemCamera = () => {
    if (!systemCameraInput) {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.setAttribute("capture", "environment");
      input.style.position = "fixed";
      input.style.left = "-9999px";
      input.style.top = "0";
      document.body.appendChild(input);
      systemCameraInput = input;
    }

    systemCameraInput.value = "";
    systemCameraInput.click();
  };

  const cacheRearCameraDeviceIdFromTrack = (track) => {
    if (!track || typeof track.getSettings !== "function") {
      return;
    }

    const settings = track.getSettings();
    if (settings && settings.deviceId) {
      rearCameraDeviceId = settings.deviceId;
    }
  };

  const isLikelyFrontTrack = (track) => {
    if (!track) {
      return false;
    }

    const label = track.label || "";
    if (label && FRONT_CAMERA_LABEL_RE.test(label) && !REAR_CAMERA_LABEL_RE.test(label)) {
      return true;
    }

    if (typeof track.getSettings === "function") {
      const settings = track.getSettings();
      if (settings && settings.facingMode === "user") {
        return true;
      }
    }

    return false;
  };

  const refreshRearCameraDeviceId = async () => {
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.enumerateDevices !== "function") {
      return rearCameraDeviceId;
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter((device) => device.kind === "videoinput");
      if (videoInputs.length === 0) {
        return rearCameraDeviceId;
      }

      let bestDevice = null;
      let bestScore = -Infinity;

      videoInputs.forEach((device, index) => {
        const label = device.label || "";
        let score = 0;

        if (label) {
          if (REAR_CAMERA_LABEL_RE.test(label)) {
            score += 4;
          }

          if (FRONT_CAMERA_LABEL_RE.test(label)) {
            score -= 4;
          }

          if (/wide|主摄|后置|back camera|camera 0|cam0/i.test(label)) {
            score += 1;
          }
        }

        score += Math.max(0, 3 - index * 0.3);

        if (score > bestScore) {
          bestScore = score;
          bestDevice = device;
        }
      });

      if (bestDevice && bestDevice.deviceId) {
        rearCameraDeviceId = bestDevice.deviceId;
      }
    } catch (error) {
      // ignore enumerate failures
    }

    return rearCameraDeviceId;
  };

  const buildTorchVideoAttempts = () => {
    const attempts = [];

    if (rearCameraDeviceId) {
      attempts.push({ deviceId: { exact: rearCameraDeviceId } });
      attempts.push({
        deviceId: { exact: rearCameraDeviceId },
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      });
    }

    return attempts.concat(TORCH_VIDEO_ATTEMPTS);
  };

  const getTorchCapabilities = (track) => {
    if (!track || typeof track.getCapabilities !== "function") {
      return null;
    }

    try {
      return track.getCapabilities();
    } catch (error) {
      return null;
    }
  };

  const tryEnableTorchWithImageCapture = async (track) => {
    if (typeof window.ImageCapture !== "function") {
      return false;
    }

    try {
      const controller = new window.ImageCapture(track);
      await controller.getPhotoCapabilities();
      await controller.setOptions({ fillLightMode: "flash" });
      imageCaptureController = controller;
      return true;
    } catch (error) {
      return false;
    }
  };

  const tryEnableTorchOnTrack = async (track) => {
    if (!track || typeof track.applyConstraints !== "function") {
      return false;
    }

    const capabilities = getTorchCapabilities(track);
    if (capabilities && !capabilities.torch) {
      return false;
    }

    const attempts = [
      { advanced: [{ torch: true }] },
      { advanced: [{ torch: true, focusMode: "continuous" }] },
      { advanced: [{ torch: true, exposureMode: "continuous" }] }
    ];

    for (const constraints of attempts) {
      try {
        await track.applyConstraints(constraints);
        return true;
      } catch (error) {
        // try next pattern
      }
    }

    return false;
  };

  const stopOpenedCapture = (opened) => {
    if (!opened) {
      return;
    }

    const { stream, track } = opened;

    if (track) {
      track.stop();
    }

    if (stream) {
      if (torchPreviewVideo && torchPreviewVideo.srcObject === stream) {
        detachPreviewStream();
      }

      stream.getTracks().forEach((item) => item.stop());
    }
  };

  const openCameraTrack = async (videoConfig, options = {}) => {
    const { requireRear = false } = options;
    const stream = await navigator.mediaDevices.getUserMedia({ video: videoConfig, audio: false });
    const [track] = stream.getVideoTracks();

    if (!track) {
      stream.getTracks().forEach((item) => item.stop());
      return null;
    }

    if (requireRear && isLikelyFrontTrack(track)) {
      stream.getTracks().forEach((item) => item.stop());
      return null;
    }

    cacheRearCameraDeviceIdFromTrack(track);
    await attachPreviewStream(stream);

    return { stream, track };
  };

  const clearTorchTimer = () => {
    if (torchTimerId) {
      clearTimeout(torchTimerId);
      torchTimerId = null;
    }

    if (torchRetryTimerId) {
      clearTimeout(torchRetryTimerId);
      torchRetryTimerId = null;
    }
  };

  const releaseTorchStream = () => {
    if (torchTrack) {
      torchTrack.stop();
      torchTrack = null;
    }

    if (torchStream) {
      if (torchPreviewVideo && torchPreviewVideo.srcObject === torchStream) {
        detachPreviewStream();
      }

      torchStream.getTracks().forEach((item) => item.stop());
      torchStream = null;
    } else {
      detachPreviewStream();
    }

    imageCaptureController = null;
  };

  const enableTorch = async (options = {}) => {
    const { forceRefresh = false } = options;

    if (torchUnavailable || torchRequestInFlight) {
      return false;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      torchUnavailable = true;
      return false;
    }

    torchRequestInFlight = true;
    try {
      if (forceRefresh) {
        releaseTorchStream();
      }

      await refreshRearCameraDeviceId();

      if (torchTrack && !forceRefresh) {
        cacheRearCameraDeviceIdFromTrack(torchTrack);

        const enabledOnExistingTrack =
          (await tryEnableTorchOnTrack(torchTrack)) ||
          (await tryEnableTorchWithImageCapture(torchTrack));

        if (enabledOnExistingTrack) {
          return true;
        }

        releaseTorchStream();
      }

      const cameraAttempts = buildTorchVideoAttempts();

      for (const videoConfig of cameraAttempts) {
        let opened = null;

        try {
          opened = await openCameraTrack(videoConfig, { requireRear: true });
        } catch (error) {
          continue;
        }

        if (!opened) {
          continue;
        }

        const { stream, track } = opened;
        const enabled =
          (await tryEnableTorchOnTrack(track)) ||
          (await tryEnableTorchWithImageCapture(track));

        if (enabled) {
          torchStream = stream;
          torchTrack = track;
          torchUnavailable = false;
          return true;
        }

        stopOpenedCapture(opened);
      }

      torchUnavailable = true;
      console.warn("设备不支持手电筒约束");
      return false;
    } finally {
      torchRequestInFlight = false;
    }
  };

  const warmupTorchPermission = async () => {
    if (torchUnavailable || torchTrack || torchRequestInFlight) {
      return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      torchUnavailable = true;
      return;
    }

    torchRequestInFlight = true;
    try {
      await refreshRearCameraDeviceId();

      const cameraAttempts = buildTorchVideoAttempts();

      for (const videoConfig of cameraAttempts) {
        let opened = null;

        try {
          opened = await openCameraTrack(videoConfig, { requireRear: true });
        } catch (error) {
          continue;
        }

        if (!opened) {
          continue;
        }

        const { stream, track } = opened;
        const capabilities = getTorchCapabilities(track);

        if (capabilities && capabilities.torch === false && typeof window.ImageCapture !== "function") {
          stopOpenedCapture(opened);
          continue;
        }

        torchStream = stream;
        torchTrack = track;
        torchUnavailable = false;
        return;
      }

      console.warn("预热未拿到可用后置摄像头轨道，将在最终阶段重试");
    } finally {
      torchRequestInFlight = false;
    }
  };

  const disableTorch = async () => {
    if (!torchTrack) {
      releaseTorchStream();
      return;
    }

    try {
      await torchTrack.applyConstraints({ advanced: [{ torch: false }] });
    } catch (error) {
      console.warn("手电筒关闭失败：", error);
    }

    releaseTorchStream();
  };

  const runTorchCue = (cue) => {
    if (cue === "lightAfter2s") {
      clearTorchTimer();
      torchTimerId = window.setTimeout(() => {
        enableTorch({ forceRefresh: true }).then((enabled) => {
          if (enabled) {
            return;
          }

          torchUnavailable = false;
          torchRetryTimerId = window.setTimeout(() => {
            enableTorch({ forceRefresh: true });
            torchRetryTimerId = null;
          }, 900);
        });

        torchTimerId = null;
      }, 2000);
      return;
    }

    if (cue === "warmup") {
      warmupTorchPermission();
      return;
    }

    clearTorchTimer();
    disableTorch();
  };

  const clearThemeClasses = () => {
    if (!appShell) {
      return;
    }

    Object.values(THEME_CONFIG).forEach((config) => {
      appShell.classList.remove(config.className);
    });
  };

  const applyTheme = (themeKey = "default") => {
    const validThemeKey = THEME_CONFIG[themeKey] ? themeKey : "default";
    currentThemeKey = validThemeKey;

    clearThemeClasses();
    if (appShell) {
      appShell.classList.add(THEME_CONFIG[validThemeKey].className);
    }

    initOceanParticles();
  };

  const createParticle = (theme) => {
    const dot = document.createElement("span");
    const left = Math.random() * 100;
    const duration = theme.durationMin + Math.random() * theme.durationRange;
    const delay = -Math.random() * duration;
    const driftX = (Math.random() - 0.5) * 20;

    if (theme.particleShape === "rain") {
      const width = theme.particleMin + Math.random() * (theme.particleMax - theme.particleMin);
      const height = 16 + Math.random() * 28;
      dot.style.width = `${width}px`;
      dot.style.height = `${height}px`;
    } else {
      const size = theme.particleMin + Math.random() * (theme.particleMax - theme.particleMin);
      dot.style.width = `${size}px`;
      dot.style.height = `${size}px`;
    }

    dot.style.left = `${left}%`;
    dot.style.animationDuration = `${duration}s`;
    dot.style.animationDelay = `${delay}s`;
    dot.style.setProperty("--drift-x", `${driftX}px`);

    return dot;
  };

  const initOceanParticles = () => {
    if (!particlesRoot) {
      return;
    }

    const theme = THEME_CONFIG[currentThemeKey] || THEME_CONFIG.default;
    const particleCount = theme.particleCount;
    const fragment = document.createDocumentFragment();

    particlesRoot.innerHTML = "";

    for (let i = 0; i < particleCount; i += 1) {
      fragment.appendChild(createParticle(theme));
    }

    particlesRoot.appendChild(fragment);
  };

  const renderHero = (scene) => {
    if (!sceneHero) {
      return;
    }

    if (scene.heroImage) {
      sceneHero.src = resolveAssetUrl(scene.heroImage);
      sceneHero.alt = scene.heroAlt || "场景图片";
      sceneHero.classList.add("is-visible");
      return;
    }

    sceneHero.classList.remove("is-visible");
    sceneHero.removeAttribute("src");
    sceneHero.alt = "";
  };

  const getChoicesForScene = (scene) => {
    if (Array.isArray(scene.choices) && scene.choices.length > 0) {
      return scene.choices;
    }

    if (scene.next) {
      return [
        {
          label: scene.choiceLabel || "继续",
          next: scene.next,
          audioCue: scene.audioCue || null
        }
      ];
    }

    return [];
  };

  const handleChoiceAction = (choice) => {
    if (choice.cameraAction === "openSystemCamera") {
      openSystemCamera();
      return true;
    }

    return false;
  };

  const renderChoices = (scene) => {
    choicesBox.innerHTML = "";
    const choices = getChoicesForScene(scene);

    choices.forEach((choice) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "choice-btn";
      button.textContent = choice.label;

      button.addEventListener("click", () => {
        if (isTransitioning) {
          return;
        }

        if (handleChoiceAction(choice)) {
          return;
        }

        if (!choice.next) {
          return;
        }

        isTransitioning = true;
        setButtonsDisabled(true);
        runAudioCue(choice.audioCue || scene.audioCue);

        const upcomingScene = getScene(choice.next);
        if (upcomingScene && upcomingScene.torchCue === "warmup") {
          runTorchCue("warmup");
        }

        switchScene(choice.next);
      });

      choicesBox.appendChild(button);
    });
  };

  const switchScene = (nextSceneId) => {
    const nextScene = getScene(nextSceneId);
    if (!nextScene) {
      console.error(`找不到场景：${nextSceneId}`);
      isTransitioning = false;
      setButtonsDisabled(false);
      return;
    }

    scenePanel.classList.add("is-fading-out");

    window.setTimeout(() => {
      currentSceneId = nextSceneId;
      applyTheme(nextScene.theme || "default");
      runTorchCue(nextScene.torchCue || null);
      renderHero(nextScene);
      sceneText.textContent = nextScene.text;
      renderChoices(nextScene);

      scenePanel.classList.remove("is-fading-out");
      scenePanel.classList.add("is-fading-in");

      window.setTimeout(() => {
        scenePanel.classList.remove("is-fading-in");
        isTransitioning = false;
        setButtonsDisabled(false);
      }, FADE_IN_MS);
    }, FADE_OUT_MS);
  };

  const init = () => {
    const firstScene = getScene(currentSceneId);
    if (!firstScene) {
      console.error(`初始场景不存在：${currentSceneId}`);
      return;
    }

    applyTheme(firstScene.theme || "default");
    runTorchCue(firstScene.torchCue || null);
    renderHero(firstScene);
    sceneText.textContent = firstScene.text;
    renderChoices(firstScene);
  };

  window.addEventListener("beforeunload", () => {
    clearTorchTimer();
    releaseTorchStream();
  });

  init();
})();
