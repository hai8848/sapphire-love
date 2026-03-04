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
  let torchUnavailable = false;
  let torchRequestInFlight = false;

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

  const openCameraTrack = async (videoConfig) => {
    const stream = await navigator.mediaDevices.getUserMedia({ video: videoConfig, audio: false });
    const [track] = stream.getVideoTracks();

    if (!track) {
      stream.getTracks().forEach((item) => item.stop());
      return null;
    }

    return { stream, track };
  };

  const clearTorchTimer = () => {
    if (!torchTimerId) {
      return;
    }

    clearTimeout(torchTimerId);
    torchTimerId = null;
  };

  const releaseTorchStream = () => {
    if (torchTrack) {
      torchTrack.stop();
      torchTrack = null;
    }

    if (torchStream) {
      torchStream.getTracks().forEach((item) => item.stop());
      torchStream = null;
    }
  };

  const enableTorch = async () => {
    if (torchUnavailable || torchRequestInFlight) {
      return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      torchUnavailable = true;
      return;
    }

    torchRequestInFlight = true;
    try {
      if (torchTrack) {
        const enabledOnExistingTrack = await tryEnableTorchOnTrack(torchTrack);
        if (enabledOnExistingTrack) {
          return;
        }

        releaseTorchStream();
      }

      for (const videoConfig of TORCH_VIDEO_ATTEMPTS) {
        let opened = null;

        try {
          opened = await openCameraTrack(videoConfig);
        } catch (error) {
          continue;
        }

        if (!opened) {
          continue;
        }

        const { stream, track } = opened;
        const enabled = await tryEnableTorchOnTrack(track);

        if (enabled) {
          torchStream = stream;
          torchTrack = track;
          return;
        }

        track.stop();
        stream.getTracks().forEach((item) => item.stop());
      }

      torchUnavailable = true;
      console.warn("设备不支持手电筒约束");
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
      for (const videoConfig of TORCH_VIDEO_ATTEMPTS) {
        let opened = null;

        try {
          opened = await openCameraTrack(videoConfig);
        } catch (error) {
          continue;
        }

        if (!opened) {
          continue;
        }

        const { stream, track } = opened;
        const capabilities = getTorchCapabilities(track);

        if (capabilities && capabilities.torch === false) {
          track.stop();
          stream.getTracks().forEach((item) => item.stop());
          continue;
        }

        torchStream = stream;
        torchTrack = track;
        return;
      }

      console.warn("预热未拿到可用后置摄像头轨道，将在最终阶段重试");
    } finally {
      torchRequestInFlight = false;
    }
  };

  const disableTorch = async () => {
    if (!torchTrack) {
      return;
    }

    try {
      await torchTrack.applyConstraints({ advanced: [{ torch: false }] });
    } catch (error) {
      console.warn("手电筒关闭失败：", error);
    }

    torchTrack.stop();
    if (torchStream) {
      torchStream.getTracks().forEach((item) => item.stop());
    }

    torchTrack = null;
    torchStream = null;
  };

  const runTorchCue = (cue) => {
    if (cue === "lightAfter2s") {
      clearTorchTimer();
      torchTimerId = window.setTimeout(() => {
        enableTorch();
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

  init();
})();
