/* global Html5Qrcode, Html5QrcodeSupportedFormats */

/** Thin wrapper over html5-qrcode: start/stop, front/back switch and flashlight. */
export class Camera {
    constructor(elementId, onScan) {
        this.elementId = elementId;
        this.onScan = onScan;
        this.reader = null;
        this.facingMode = 'environment';
        this.torchOn = false;
    }

    get running() {
        return Boolean(this.reader?.isScanning);
    }

    async start(facingMode = this.facingMode) {
        await this.stop();
        this.facingMode = facingMode;
        this.reader = new Html5Qrcode(this.elementId, {
            formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
            useBarCodeDetectorIfSupported: true,
            experimentalFeatures: { useBarCodeDetectorIfSupported: true },
            verbose: false,
        });
        await this.reader.start(
            { facingMode },
            {
                fps: 12,
                qrbox: (w, h) => {
                    const size = Math.max(160, Math.floor(Math.min(w, h) * 0.7));
                    return { width: size, height: size };
                },
            },
            (text) => this.onScan(text),
            () => {},
        );
        this.torchOn = false;
    }

    async stop() {
        if (!this.reader) return;
        try {
            if (this.reader.isScanning) await this.reader.stop();
            this.reader.clear();
        } catch {
            // Already stopped; nothing to release.
        }
        this.reader = null;
    }

    torch() {
        try {
            const feature = this.reader?.getRunningTrackCameraCapabilities().torchFeature();
            return feature?.isSupported() ? feature : null;
        } catch {
            return null;
        }
    }

    async toggleTorch() {
        const feature = this.torch();
        if (!feature) return false;
        this.torchOn = !this.torchOn;
        await feature.apply(this.torchOn);
        return this.torchOn;
    }
}

/** Human-readable reason for a camera start failure. */
export function cameraErrorMessage(err) {
    const text = String(err?.message || err);
    if (!window.isSecureContext) {
        return 'Camera access needs HTTPS. Open the scanner at https://<server>:8443/scanner/ instead.';
    }
    if (/NotAllowed|Permission/i.test(text)) return 'Camera permission was denied. Allow camera access in your browser settings, then try again.';
    if (/NotFound|Requested device not found|no camera/i.test(text)) return 'No camera was found on this device.';
    if (/NotReadable|in use|Could not start/i.test(text)) return 'The camera is being used by another app. Close it and try again.';
    return `Could not start the camera: ${text}`;
}
