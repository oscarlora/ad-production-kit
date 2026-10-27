# Resemble Enhance on one WAV: python enhance_voice.py <in.wav> <out.wav> [nfe] [model_dir]
# Used by tools/fix-voice.mjs enhance. Picks CUDA, then Apple MPS, else CPU.
import sys, torch, soundfile as sf
from pathlib import Path
import scipy.optimize, resemble_enhance.enhancer.lcfm.cfm as cfm
_fs = scipy.optimize.fsolve  # newer scipy returns an array where resemble-enhance expects a scalar
cfm.scipy.optimize.fsolve = lambda *a, **k: _fs(*a, **k).reshape(-1)[:1].item()
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
