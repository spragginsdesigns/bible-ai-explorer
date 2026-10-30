/* AudioWorklet: continuous mono resampling, independent of render-block size. */
class SureWordPcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.enabled = false;
    this.position = 0;
    this.nextOutput = 0;
    this.previous = 0;
    this.chunk = new Int16Array(480); // 20 ms at 24 kHz.
    this.used = 0;
    this.port.onmessage = ({ data }) => {
      this.enabled = data?.enabled === true;
      this.used = 0;
    };
  }

  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i += 1) {
      let value = 0;
      for (const channel of channels) value += channel[i] || 0;
      value /= channels.length;
      // Linear interpolation retains its fractional phase across blocks. Never
      // assume the browser honored a requested AudioContext sample rate.
      while (this.nextOutput <= this.position) {
        const fraction = this.position === 0 ? 1 : this.nextOutput - (this.position - 1);
        const sample = Math.max(-1, Math.min(1, this.previous + (value - this.previous) * fraction));
        if (this.enabled) {
          this.chunk[this.used++] = Math.round(sample * (sample < 0 ? 32768 : 32767));
          if (this.used === this.chunk.length) {
            // Explicit little endian, irrespective of the host's byte order.
            const bytes = new ArrayBuffer(this.chunk.length * 2);
            const view = new DataView(bytes);
            for (let n = 0; n < this.chunk.length; n += 1) view.setInt16(n * 2, this.chunk[n], true);
            this.port.postMessage(bytes, [bytes]);
            this.used = 0;
          }
        }
        this.nextOutput += sampleRate / 24000;
      }
      this.previous = value;
      this.position += 1;
    }
    return true;
  }
}

registerProcessor("sureword-pcm-capture", SureWordPcmCapture);
