class AudiobookDJ {
    constructor() {
        this.vinyl = document.getElementById('vinyl');
        this.audioFile = document.getElementById('audioFile');
        this.playBtn = document.getElementById('playBtn');
        this.pauseBtn = document.getElementById('pauseBtn');
        this.resetBtn = document.getElementById('resetBtn');
        this.speedDisplay = document.getElementById('speedDisplay');
        this.directionDisplay = document.getElementById('directionDisplay');
        this.timeDisplay = document.getElementById('timeDisplay');
        this.progressFill = document.getElementById('progressFill');

        this.audio = new Audio();
        this.audioContext = null;
        this.source = null;
        this.isPlaying = false;
        this.isDragging = false;
        this.currentRotation = 0;
        this.lastAngle = 0;
        this.rotationSpeed = 0;
        this.playbackRate = 1;
        this.direction = 1; // 1 for forward, -1 for reverse
        
        // Momentum system
        this.momentum = 0; // Accumulated momentum from spinning
        this.maxMomentum = 100; // Maximum momentum value
        this.momentumDecay = 0.95; // How fast momentum decays when not spinning
        this.momentumBuild = 0.3; // How fast momentum builds up
        this.lastDragTime = 0;
        this.dragDuration = 0; // How long we've been dragging
        
        // Reverse chunk management
        this.chunkDuration = 1.5; // seconds per chunk for better word comprehension
        this.chunkGap = 0.2; // gap between chunks in seconds
        this.currentChunkStart = 0;
        this.isInGap = false;
        this.lastChunkTime = 0;

        this.initEventListeners();
        this.animationLoop();
    }

    initEventListeners() {
        this.audioFile.addEventListener('change', (e) => this.loadAudio(e));
        this.playBtn.addEventListener('click', () => this.play());
        this.pauseBtn.addEventListener('click', () => this.pause());
        this.resetBtn.addEventListener('click', () => this.reset());

        // Turntable interaction
        this.vinyl.addEventListener('mousedown', (e) => this.startDrag(e));
        document.addEventListener('mousemove', (e) => this.drag(e));
        document.addEventListener('mouseup', () => this.stopDrag());

        // Touch support
        this.vinyl.addEventListener('touchstart', (e) => this.startDrag(e.touches[0]));
        document.addEventListener('touchmove', (e) => {
            if (this.isDragging) {
                e.preventDefault();
                this.drag(e.touches[0]);
            }
        });
        document.addEventListener('touchend', () => this.stopDrag());

        // Audio events
        this.audio.addEventListener('timeupdate', () => this.updateDisplay());
        this.audio.addEventListener('loadedmetadata', () => this.updateDisplay());
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
            this.vinyl.classList.add('spinning');
        }
    }

    pause() {
        this.audio.pause();
        this.isPlaying = false;
        this.vinyl.classList.remove('spinning');
    }

    reset() {
        this.pause();
        this.audio.currentTime = 0;
        this.currentRotation = 0;
        this.rotationSpeed = 0;
        this.direction = 1;
        this.currentChunkStart = 0;
        this.isInGap = false;
        this.updateDisplay();
    }

    startDrag(e) {
        this.isDragging = true;
        this.vinyl.classList.remove('spinning');
        
        // Initialize momentum tracking
        this.lastDragTime = Date.now();
        this.dragDuration = 0;
        
        const rect = this.vinyl.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        this.lastAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX);
    }

    drag(e) {
        if (!this.isDragging || !this.audio.src) return;

        const rect = this.vinyl.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const angle = Math.atan2(e.clientY - centerY, e.clientX - centerX);
        
        let deltaAngle = angle - this.lastAngle;
        
        // Handle angle wrap-around
        if (deltaAngle > Math.PI) deltaAngle -= 2 * Math.PI;
        if (deltaAngle < -Math.PI) deltaAngle += 2 * Math.PI;
        
        this.currentRotation += deltaAngle * (180 / Math.PI);
        this.vinyl.style.transform = `rotate(${this.currentRotation}deg)`;
        
        // Calculate rotation speed and momentum
        const now = Date.now();
        const deltaTime = now - this.lastDragTime;
        
        if (deltaTime > 0) {
            const instantSpeed = Math.abs(deltaAngle) * 10;
            this.direction = deltaAngle > 0 ? 1 : -1;
            
            // Build momentum based on speed and duration
            this.dragDuration += deltaTime;
            const speedFactor = Math.min(instantSpeed / 5, 1); // Normalize speed
            const durationFactor = Math.min(this.dragDuration / 2000, 1); // Duration bonus (2 seconds max)
            
            // Add momentum based on current speed and how long we've been spinning
            this.momentum += speedFactor * this.momentumBuild * (1 + durationFactor);
            this.momentum = Math.min(this.momentum, this.maxMomentum);
            
            // Use momentum + instant speed for final rotation speed
            this.rotationSpeed = instantSpeed + (this.momentum * 0.3);
        }
        
        this.lastDragTime = now;
        
        // Update playback based on rotation
        this.updatePlayback();
        
        this.lastAngle = angle;
    }

    stopDrag() {
        this.isDragging = false;
        this.dragDuration = 0; // Reset drag duration
        if (this.isPlaying) {
            this.vinyl.classList.add('spinning');
        }
        // Gradually slow down using momentum decay
        this.rotationSpeed *= 0.9;
    }

    updatePlayback() {
        if (!this.audio.src) return;

        // Map rotation speed to playback rate (0.5x to 3x)
        // But if not dragging and speed is very low, return to normal 1x
        if (!this.isDragging && this.rotationSpeed < 0.1) {
            this.playbackRate = 1.0;
        } else {
            this.playbackRate = Math.min(3, Math.max(0.5, this.rotationSpeed));
        }
        
        if (this.direction === 1) {
            // Forward playback
            this.audio.playbackRate = this.playbackRate;
            this.directionDisplay.textContent = 'Forward';
            this.isInGap = false;
            
            // Scrub forward
            if (this.isDragging) {
                this.audio.currentTime = Math.min(
                    this.audio.duration,
                    this.audio.currentTime + (this.rotationSpeed * 0.1)
                );
            }
        } else {
            // Reverse playback with chunks
            this.directionDisplay.textContent = 'Reverse (Chunked)';
            this.handleReverseChunks();
        }
        
        this.speedDisplay.textContent = `${this.playbackRate.toFixed(1)}x`;
        
        // Auto-play when scratching
        if (this.isDragging && !this.isPlaying && this.rotationSpeed > 0.1) {
            this.play();
        }
    }

    handleReverseChunks() {
        if (!this.isDragging) return;
        
        const currentTime = this.audio.currentTime;
        const now = Date.now();
        
        // Check if we should be in a gap
        if (this.isInGap) {
            if (now - this.lastChunkTime > this.chunkGap * 1000) {
                this.isInGap = false;
                this.currentChunkStart = currentTime;
            } else {
                return; // Still in gap, don't update audio
            }
        }
        
        // Move backwards within the current chunk
        const chunkProgress = this.currentChunkStart - currentTime;
        
        if (chunkProgress < this.chunkDuration) {
            // Still within chunk, move backwards
            this.audio.currentTime = Math.max(
                0,
                currentTime - (this.rotationSpeed * 0.1)
            );
        } else {
            // Reached end of chunk, enter gap
            this.isInGap = true;
            this.lastChunkTime = now;
            // Jump to start of next chunk (backwards)
            this.audio.currentTime = Math.max(
                0,
                this.currentChunkStart - this.chunkDuration - 0.5
            );
            this.pause(); // Pause during gap
            setTimeout(() => {
                if (this.direction === -1 && this.isDragging) {
                    this.play();
                }
            }, this.chunkGap * 1000);
        }
    }

    updateDisplay() {
        if (!this.audio.src) return;
        
        const current = this.audio.currentTime;
        const duration = this.audio.duration || 0;
        
        const formatTime = (time) => {
            const minutes = Math.floor(time / 60);
            const seconds = Math.floor(time % 60);
            return `${minutes}:${seconds.toString().padStart(2, '0')}`;
        };
        
        this.timeDisplay.textContent = `${formatTime(current)} / ${formatTime(duration)}`;
        this.progressFill.style.width = `${(current / duration) * 100}%`;
    }

    animationLoop() {
        if (!this.isDragging && this.rotationSpeed > 0.01) {
            // Decay momentum when not dragging
            this.momentum *= this.momentumDecay;
            this.rotationSpeed *= 0.95;
            this.updatePlayback();
        }
        
        requestAnimationFrame(() => this.animationLoop());
    }
}

// Initialize the DJ turntable
const dj = new AudiobookDJ();