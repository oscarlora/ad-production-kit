# Resemble Enhance on one WAV: python enhance_voice.py <in.wav> <out.wav> [nfe] [model_dir]
# Used by tools/fix-voice.mjs enhance. Picks CUDA, then Apple MPS, else CPU.
import sys, torch, soundfile as sf
from pathlib import Path
import importlib.util
# newer scipy: fsolve returns an array where resemble-enhance 0.0.1 wants a scalar; patch its source once
_cfm = Path(importlib.util.find_spec('resemble_enhance').origin).parent / 'enhancer' / 'lcfm' / 'cfm.py'
_src = _cfm.read_text()
if 'x0=0))' in _src: _cfm.write_text(_src.replace('x0=0))', 'x0=0)[0])'))
import os, types
# deepspeed is only used for training and doesn't install on Mac/Windows: stub it for inference
if os.environ.get('ADPK_STUB_DS') or importlib.util.find_spec('deepspeed') is None:
    class _D:
        def __init__(self, *a, **k): pass
    for _m in ['deepspeed', 'deepspeed.accelerator', 'deepspeed.runtime', 'deepspeed.runtime.engine', 'deepspeed.runtime.utils']:
        sys.modules[_m] = types.ModuleType(_m)
    sys.modules['deepspeed'].DeepSpeedConfig = _D
    sys.modules['deepspeed.accelerator'].get_accelerator = lambda: None
    sys.modules['deepspeed.runtime.engine'].DeepSpeedEngine = _D
    sys.modules['deepspeed.runtime.utils'].clip_grad_norm_ = lambda *a, **k: None
from resemble_enhance.enhancer.inference import enhance
src, dst = sys.argv[1], sys.argv[2]
nfe = int(sys.argv[3]) if len(sys.argv) > 3 else 32
model = Path(sys.argv[4]) if len(sys.argv) > 4 else Path(__file__).parent / '.model'
if not (model / 'enhancer_stage2').exists():
    from huggingface_hub import snapshot_download
    snapshot_download('ResembleAI/resemble-enhance', local_dir=str(model), allow_patterns=['enhancer_stage2/*'])
dev = 'cuda' if torch.cuda.is_available() else 'mps' if torch.backends.mps.is_available() else 'cpu'
w, sr = sf.read(src, dtype='float32')
if w.ndim > 1: w = w.mean(1)
o, osr = enhance(torch.from_numpy(w), sr, dev, nfe=nfe, solver='midpoint', lambd=0.5, tau=0.5, run_dir=model / 'enhancer_stage2')
sf.write(dst, o.cpu().numpy(), osr)
