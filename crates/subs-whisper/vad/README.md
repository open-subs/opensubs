# Voice activity detection model

`ggml-silero-v5.1.2.bin` is Silero VAD v5.1.2 (https://github.com/snakers4/silero-vad),
converted to ggml for whisper.cpp by the whisper.cpp project and published at
https://huggingface.co/ggml-org/whisper-vad. MIT-licensed; see `LICENSE-silero-vad`.

SHA-256 `29940d98d42b91fbd05ce489f3ecf7c72f0a42f027e4875919a28fb4c04ea2cf`, 885,098 bytes.
It is compiled into the binary (`include_bytes!` in `src/vad.rs`), so no installer has to carry it.
