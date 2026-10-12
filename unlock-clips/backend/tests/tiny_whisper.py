"""Gera um modelo Whisper minúsculo, com pesos aleatórios, no formato CTranslate2.

Os testes usam este modelo para exercitar de verdade o faster-whisper (carregamento,
decodificação, timestamps por palavra, progresso e cancelamento) sem baixar nada da
internet. O texto produzido é aleatório — a qualidade da transcrição só pode ser
avaliada com um modelo real (tiny, base, small...).
"""

from __future__ import annotations

import json
import string
from pathlib import Path

import numpy as np

N_MELS = 80
BASE_VOCAB = 50257  # mesmo layout dos modelos multilíngues reais (vocabulário de 51865 tokens)
SPECIALS_AFTER_LANGS = ["<|translate|>", "<|transcribe|>", "<|startoflm|>", "<|startofprev|>", "<|nospeech|>", "<|notimestamps|>"]


# Ordem oficial dos tokens de idioma do Whisper (a mesma dos modelos reais).
LANGUAGES = (
    "en zh de es ru ko fr ja pt tr pl ca nl ar sv it id hi fi vi he uk el ms cs ro da hu ta no th ur hr bg lt la "
    "mi ml cy sk te fa lv bn sr az sl kn et mk br eu is hy ne mn bs kk sq sw gl mr pa si km sn yo so af oc ka be "
    "tg sd gu am yi lo uz fo ht ps tk nn mt sa lb my bo tl mg as tt haw ln ha ba jw su"
).split()


def _language_codes() -> list[str]:
    assert len(LANGUAGES) == 99
    return LANGUAGES


def _vocabulary() -> list[str]:
    from tokenizers import pre_tokenizers

    alphabet = sorted(pre_tokenizers.ByteLevel.alphabet())
    # O CTranslate2 reconhece um modelo multilíngue pela presença do token vazio "".
    tokens = [*alphabet, ""]
    rng = np.random.default_rng(0)
    letters = list(string.ascii_lowercase)
    seen = set(tokens)
    while len(tokens) < BASE_VOCAB:
        word = "Ġ" + "".join(rng.choice(letters, size=int(rng.integers(2, 8))))
        if word not in seen:
            seen.add(word)
            tokens.append(word)
    tokens.append("<|endoftext|>")
    tokens.append("<|startoftranscript|>")
    tokens.extend(f"<|{code}|>" for code in _language_codes())
    tokens.extend(SPECIALS_AFTER_LANGS)
    tokens.extend("<|%.2f|>" % (i * 0.02) for i in range(1501))
    assert len(tokens) == 51865, len(tokens)
    return tokens


def _tokenizer_json(tokens: list[str]) -> str:
    from tokenizers import Tokenizer, decoders, models, pre_tokenizers

    special = [t for t in tokens if t.startswith("<|") and t.endswith("|>")]
    tokenizer = Tokenizer(models.BPE(vocab={t: i for i, t in enumerate(tokens)}, merges=[]))
    tokenizer.pre_tokenizer = pre_tokenizers.ByteLevel(add_prefix_space=False)
    tokenizer.decoder = decoders.ByteLevel()
    tokenizer.add_special_tokens(special)
    return tokenizer.to_str()


def build_tiny_whisper(output_dir: Path, d_model: int = 64, layers: int = 2, heads: int = 2, seed: int = 0) -> Path:
    from ctranslate2.specs import whisper_spec

    rng = np.random.default_rng(seed)
    tokens = _vocabulary()
    vocab = len(tokens)
    ff = d_model * 4

    def w(*shape: int) -> np.ndarray:
        return (rng.standard_normal(shape) * 0.05).astype(np.float32)

    def norm(spec) -> None:
        spec.gamma = np.ones(d_model, dtype=np.float32)
        spec.beta = np.zeros(d_model, dtype=np.float32)

    spec = whisper_spec.WhisperSpec(layers, heads, layers, heads)
    spec.encoder.conv1.weight = w(d_model, N_MELS, 3)
    spec.encoder.conv2.weight = w(d_model, d_model, 3)
    spec.encoder.position_encodings.encodings = w(1500, d_model)
    norm(spec.encoder.layer_norm)
    for layer in spec.encoder.layer:
        layer.self_attention.linear[0].weight = w(3 * d_model, d_model)
        layer.self_attention.linear[1].weight = w(d_model, d_model)
        norm(layer.self_attention.layer_norm)
        layer.ffn.linear_0.weight = w(ff, d_model)
        layer.ffn.linear_1.weight = w(d_model, ff)
        norm(layer.ffn.layer_norm)

    spec.decoder.embeddings.weight = w(vocab, d_model)
    spec.decoder.projection.weight = w(vocab, d_model)
    spec.decoder.position_encodings.encodings = w(448, d_model)
    norm(spec.decoder.layer_norm)
    for layer in spec.decoder.layer:
        layer.self_attention.linear[0].weight = w(3 * d_model, d_model)
        layer.self_attention.linear[1].weight = w(d_model, d_model)
        norm(layer.self_attention.layer_norm)
        layer.attention.linear[0].weight = w(d_model, d_model)
        layer.attention.linear[1].weight = w(2 * d_model, d_model)
        layer.attention.linear[2].weight = w(d_model, d_model)
        norm(layer.attention.layer_norm)
        layer.ffn.linear_0.weight = w(ff, d_model)
        layer.ffn.linear_1.weight = w(d_model, ff)
        norm(layer.ffn.layer_norm)

    index = {t: i for i, t in enumerate(tokens)}
    lang_ids = [index[f"<|{code}|>"] for code in _language_codes()]
    spec.config.suppress_ids = [index["<|translate|>"], index["<|transcribe|>"]]
    spec.config.suppress_ids_begin = [220, index["<|endoftext|>"]]
    spec.config.lang_ids = lang_ids
    spec.config.alignment_heads = [[layers - 1, h] for h in range(heads)]
    spec.register_vocabulary(tokens)
    spec.validate()
    spec.optimize(quantization="float32")

    output_dir.mkdir(parents=True, exist_ok=True)
    spec.save(str(output_dir))
    (output_dir / "tokenizer.json").write_text(_tokenizer_json(tokens), encoding="utf-8")
    (output_dir / "preprocessor_config.json").write_text(
        json.dumps({"feature_size": N_MELS, "sampling_rate": 16000, "hop_length": 160, "chunk_length": 30, "n_fft": 400}),
        encoding="utf-8",
    )
    return output_dir


if __name__ == "__main__":
    import sys

    print(build_tiny_whisper(Path(sys.argv[1])))
