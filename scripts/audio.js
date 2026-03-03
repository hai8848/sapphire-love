(() => {
  class AudioController {
    constructor(src) {
      this.src = src;
      this.audio = null;
      this.fadeFrame = null;
      this.hasStarted = false;
    }

    ensureAudio() {
      if (!this.audio) {
        const audio = new Audio(this.src);
        audio.loop = true;
        audio.preload = "auto";
        audio.volume = 0.001;
        this.audio = audio;
      }
      return this.audio;
    }

    startFadeIn({ duration = 9000, targetVolume = 0.4 } = {}) {
      if (this.hasStarted) {
        return;
      }

      const audio = this.ensureAudio();
      this.hasStarted = true;
      audio.volume = 0.001;

      const startAt = performance.now();
      const fadeStep = (now) => {
        const progress = Math.min((now - startAt) / duration, 1);
        audio.volume = 0.001 + (targetVolume - 0.001) * progress;

        if (progress < 1) {
          this.fadeFrame = requestAnimationFrame(fadeStep);
        }
      };

      const playPromise = audio.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch((error) => {
          if (this.fadeFrame) {
            cancelAnimationFrame(this.fadeFrame);
            this.fadeFrame = null;
          }
          this.hasStarted = false;
          console.warn("背景音乐播放失败：", error);
        });
      }

      this.fadeFrame = requestAnimationFrame(fadeStep);
    }
  }

  window.createAudioController = (src) => new AudioController(src);
})();
