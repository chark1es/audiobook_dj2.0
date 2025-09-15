class AudiobookDJ {
    constructor() {
        this.vinyl = document.getElementById("vinyl");
        this.audioFile = document.getElementById("audioFile");
        this.playBtn = document.getElementById("playBtn");
        this.pauseBtn = document.getElementById("pauseBtn");
        this.resetBtn = document.getElementById("resetBtn");
        this.speedDisplay = document.getElementById("speedDisplay");
        this.directionDisplay = document.getElementById("directionDisplay");
        this.timeDisplay = document.getElementById("timeDisplay");
        this.progressFill = document.getElementById("progressFill");

        this.audio = new Audio();
        this.audioContext = null;
        this.source = null;
        this.isPlaying = false;
        this.isDragging = false;
        this.currentRotation = 0;
        this.lastAngle = 0;
        this.playbackRate = 1;
        this.direction = 1; // 1 = clockwise, -1 = counter-clockwise

        // Rotation handling and thresholds
        this.angleDeadzoneRad = 0.05; // ~2.9° deadzone to avoid jitter
        this.maxPlaybackRate = 5.0; // clamp for CW speed up
        this.cwRatePerRad = 0.15; // slower cumulative rate increase per radian (needs multiple rotations to max)
        this.cwPlaybackRate = 1.0; // accumulative CW rate while dragging
        this.isCWScrub = false; // when true, CW controls time instead of speed
        this.cwScrubEnterVel = 22.0; // rad/s threshold to ENTER CW seek mode (higher = harder)
        this.cwScrubExitVel = 10.0; // rad/s threshold to EXIT CW seek mode
        this.cwScrubExitHoldMs = 300; // must stay below exit vel for this long to exit
        this.cwScrubBelowExitSince = 0; // timestamp when fell below exit vel
        this.cwSeekAngleStepDeg = 45; // degrees per forward seek step (CW fast mode)
        this.cwSeekStepSeconds = 1; // seconds jumped forward per step (CW fast mode)
        this.cwAngleAccumulatorDeg = 0; // accumulates CW rotation for forward seek steps

        // Direction switching hysteresis
        this.directionLock = 0; // 0 = none, 1 = CW, -1 = CCW
        this.switchThresholdDeg = 20; // require ~20° CCW before switching from CW
        this.switchAccumNegDeg = 0; // accumulates CCW while locked CW

        // CCW seek behavior
        this.seekAngleStepDeg = 15; // degrees per backward seek step
        this.seekStepSeconds = 5; // seconds jumped back per step
        this.ccwAngleAccumulatorDeg = 0; // accumulates CCW rotation for stepping

        // Timing used only for basic state tracking
        this.lastDragTime = 0;
        this.dragDuration = 0;

        this.initEventListeners();
        this.animationLoop();
    }

    initEventListeners() {
        this.audioFile.addEventListener("change", (e) => this.loadAudio(e));
        this.playBtn.addEventListener("click", () => this.play());
        this.pauseBtn.addEventListener("click", () => this.pause());
        this.resetBtn.addEventListener("click", () => this.reset());

        // Turntable interaction
        this.vinyl.addEventListener("mousedown", (e) => this.startDrag(e));
        document.addEventListener("mousemove", (e) => this.drag(e));
        document.addEventListener("mouseup", () => this.stopDrag());

        // Touch support
        this.vinyl.addEventListener("touchstart", (e) =>
            this.startDrag(e.touches[0])
        );
        document.addEventListener("touchmove", (e) => {
            if (this.isDragging) {
                e.preventDefault();
                this.drag(e.touches[0]);
            }
        });
        document.addEventListener("touchend", () => this.stopDrag());

        // Audio events
        this.audio.addEventListener("timeupdate", () => this.updateDisplay());
        this.audio.addEventListener("loadedmetadata", () =>
            this.updateDisplay()
        );
    }

    loadAudio(event) {
        const file = event.target.files[0];
        if (file) {
            const url = URL.createObjectURL(file);
            this.audio.src = url;
            this.audio.load();
            this.reset();
        }
    }

    play() {
        if (this.audio.src && !this.isPlaying) {
            this.audio.play();
            this.isPlaying = true;
            this.vinyl.classList.add("spinning");
        }
    }

    pause() {
        this.audio.pause();
        this.isPlaying = false;
        this.vinyl.classList.remove("spinning");
    }

    reset() {
        this.pause();
        this.audio.currentTime = 0;
        this.currentRotation = 0;
        this.direction = 1;
        this.playbackRate = 1;
        this.ccwAngleAccumulatorDeg = 0;
        this.cwPlaybackRate = 1.0;
        this.directionLock = 0;
        this.switchAccumNegDeg = 0;
        this.isCWScrub = false;
        this.cwAngleAccumulatorDeg = 0;
        this.cwScrubBelowExitSince = 0;
        this.vinyl.style.transform = `rotate(0deg)`;
        this.speedDisplay.textContent = `1.0x`;
        this.directionDisplay.textContent = "Forward";
        this.updateDisplay();
    }

    startDrag(e) {
        this.isDragging = true;
        this.vinyl.classList.remove("spinning");

        // Initialize drag state
        this.lastDragTime = Date.now();
        this.dragDuration = 0;
        this.ccwAngleAccumulatorDeg = 0;

        // Reference point: center of the vinyl element
        const rect = this.vinyl.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        this.lastAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX);
    }

    drag(e) {
        if (!this.isDragging || !this.audio.src) return;

        // Compute current angle relative to center of vinyl
        const rect = this.vinyl.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const angle = Math.atan2(e.clientY - centerY, e.clientX - centerX);

        // Delta angle (handle 0°/360° wrap)
        let deltaAngle = angle - this.lastAngle;
        if (deltaAngle > Math.PI) deltaAngle -= 2 * Math.PI;
        if (deltaAngle < -Math.PI) deltaAngle += 2 * Math.PI;

        // Ignore tiny movements (deadzone) and static drags
        if (Math.abs(deltaAngle) < this.angleDeadzoneRad) {
            this.lastAngle = angle;
            return;
        }

        // Rotate the visual vinyl
        this.currentRotation += deltaAngle * (180 / Math.PI);
        this.vinyl.style.transform = `rotate(${this.currentRotation}deg)`;

        // Determine direction based on deltaAngle sign
        const isCW = deltaAngle > 0;

        // Compute angular velocity (rad/s) to detect very fast spins
        const now = Date.now();
        const dtSec = Math.max(0.0001, (now - this.lastDragTime) / 1000);
        const angVel = Math.abs(deltaAngle) / dtSec; // rad/s

        if (isCW) {
            // Lock to CW and clear CCW switching accumulator
            this.directionLock = 1;
            this.switchAccumNegDeg = 0;

            // Reset CCW accumulator when switching to CW
            this.ccwAngleAccumulatorDeg = 0;

            // Hysteresis around seek vs speed to prevent flapping
            if (this.isCWScrub) {
                if (angVel <= this.cwScrubExitVel) {
                    // Start or continue exit hold timer
                    if (!this.cwScrubBelowExitSince) this.cwScrubBelowExitSince = now;
                    if (now - this.cwScrubBelowExitSince >= this.cwScrubExitHoldMs) {
                        // Exit seek mode only after sustained slow movement
                        this.isCWScrub = false;
                        this.cwAngleAccumulatorDeg = 0;
                        this.cwScrubBelowExitSince = 0;
                    }
                } else {
                    // Still fast; reset exit hold timer
                    this.cwScrubBelowExitSince = 0;
                }
            } else if (angVel >= this.cwScrubEnterVel) {
                // Enter seek mode at high angular velocity
                this.isCWScrub = true;
                this.cwAngleAccumulatorDeg = 0; // start fresh steps
                this.cwScrubBelowExitSince = 0;
            }

            if (this.isCWScrub) {
                // Fast CW: seek forward instead of adjusting speed
                this.cwAngleAccumulatorDeg += Math.abs(deltaAngle) * (180 / Math.PI);
                this.playbackRate = 1.0;
                this.audio.playbackRate = 1.0;
                this.directionDisplay.textContent = "Clockwise (Seek)";
                this.speedDisplay.textContent = `1.0x`;

                if (this.cwAngleAccumulatorDeg >= this.cwSeekAngleStepDeg) {
                    const steps = Math.floor(this.cwAngleAccumulatorDeg / this.cwSeekAngleStepDeg);
                    const secondsFwd = steps * this.cwSeekStepSeconds;
                    this.audio.currentTime = Math.min(this.audio.duration || Infinity, this.audio.currentTime + secondsFwd);
                    this.cwAngleAccumulatorDeg -= steps * this.cwSeekAngleStepDeg;
                }
            } else {
                // Normal CW: adjust speed cumulatively
                this.cwPlaybackRate = Math.min(
                    this.maxPlaybackRate,
                    this.cwPlaybackRate + Math.abs(deltaAngle) * this.cwRatePerRad
                );
                this.playbackRate = this.cwPlaybackRate;
                this.audio.playbackRate = this.playbackRate;
                this.directionDisplay.textContent = "Clockwise (Speed)";
                this.speedDisplay.textContent = `${this.playbackRate.toFixed(1)}x`;
            }
        } else {
            // If currently locked CW and minor CCW jitter happens, require threshold to switch
            if (this.directionLock === 1 && this.cwPlaybackRate > 1.0) {
                this.switchAccumNegDeg +=
                    Math.abs(deltaAngle) * (180 / Math.PI);
                if (this.switchAccumNegDeg < this.switchThresholdDeg) {
                    // Ignore small CCW movement; keep current CW speed
                    this.lastDragTime = now;
                    this.lastAngle = angle;
                    return;
                }
                // Passed threshold: switch to CCW mode and reset CW speed
                this.directionLock = -1;
                this.cwPlaybackRate = 1.0;
                this.isCWScrub = false;
                this.cwAngleAccumulatorDeg = 0;
                this.cwScrubBelowExitSince = 0;
            }

            // Counter-clockwise: jump backward in timeline (no reverse playback)
            // Always keep playback at 1x while seeking
            this.audio.playbackRate = 1.0;
            this.playbackRate = 1.0;
            this.speedDisplay.textContent = `1.0x`;
            this.directionDisplay.textContent = "Counter-Clockwise (Seek)";

            // Accumulate CCW rotation and seek back in steps
            this.ccwAngleAccumulatorDeg +=
                Math.abs(deltaAngle) * (180 / Math.PI);
            if (this.ccwAngleAccumulatorDeg >= this.seekAngleStepDeg) {
                const steps = Math.floor(
                    this.ccwAngleAccumulatorDeg / this.seekAngleStepDeg
                );
                const secondsBack = steps * this.seekStepSeconds;
                this.audio.currentTime = Math.max(
                    0,
                    this.audio.currentTime - secondsBack
                );
                this.ccwAngleAccumulatorDeg -= steps * this.seekAngleStepDeg;
            }
        }

        // Track time for threshold calculations
        this.lastDragTime = now;
        this.lastAngle = angle;
    }

    stopDrag() {
        this.isDragging = false;
        this.dragDuration = 0;
        this.ccwAngleAccumulatorDeg = 0;
        // Reset speed back to 1x when user stops dragging
        this.playbackRate = 1.0;
        this.audio.playbackRate = 1.0;
        this.speedDisplay.textContent = `1.0x`;
        this.directionDisplay.textContent = "Forward";
        if (this.isPlaying) {
            this.vinyl.classList.add("spinning");
        }
        // Clear CW accumulators and locks
        this.cwPlaybackRate = 1.0;
        this.directionLock = 0;
        this.switchAccumNegDeg = 0;
        this.isCWScrub = false;
        this.cwAngleAccumulatorDeg = 0;
    }

    updatePlayback() {
        if (!this.audio.src) return;
        // When not dragging, normalize to 1x with no time-based controls
        if (!this.isDragging) {
            if (this.audio.playbackRate !== 1.0) {
                this.audio.playbackRate = 1.0;
                this.playbackRate = 1.0;
                this.speedDisplay.textContent = `1.0x`;
                this.directionDisplay.textContent = "Forward";
            }
        }
    }

    updateDisplay() {
        if (!this.audio.src) return;

        const current = this.audio.currentTime;
        const duration = this.audio.duration || 0;

        const formatTime = (time) => {
            const minutes = Math.floor(time / 60);
            const seconds = Math.floor(time % 60);
            return `${minutes}:${seconds.toString().padStart(2, "0")}`;
        };

        this.timeDisplay.textContent = `${formatTime(current)} / ${formatTime(
            duration
        )}`;
        this.progressFill.style.width = `${(current / duration) * 100}%`;
    }

    animationLoop() {
        // Keep playback normalized when idle; no momentum/time-based controls
        if (!this.isDragging) {
            this.updatePlayback();
        }
        requestAnimationFrame(() => this.animationLoop());
    }
}

// Initialize the DJ turntable
const dj = new AudiobookDJ();
