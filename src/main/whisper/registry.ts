import type { ModelRegistry } from './model-manager';

export const MODEL_REGISTRY: ModelRegistry = {
  'base.en': {
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin',
    sha256: 'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002',
  },
};

export const DEFAULT_MODEL_KEY = 'base.en';
