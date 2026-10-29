// An ad's edit. Body: { ad (its folder name), and one action }: md (saveMd; 409 when it can't merge), comment (saveComment),
// approve: id, sendBack: { id, text }, decide (decideScene), voice: take (pickVoice), remove: id, trim (trimClip, returning its undo), mute (muteTrack, the same), restore (restoreEdit) or
// export: plan (startExport). Each is described in lib/server/edit.js.
import { adDir, approveComment, decideScene, muteTrack, pickVoice, removeComment, restoreEdit, saveMd, saveComment, sendBackComment, startExport, trimClip } from '../../../../../lib/server/edit.js';
import { brandPost, jsonRes } from '../../../../../lib/server/http.js';

export const POST = brandPost(async (req, ctx) => {
  const body = await req.json().catch(() => ({}));
  const dir = adDir(ctx.dir, body.ad);
  if (!dir) return jsonRes({ error: 'no such ad folder' }, 404);
  try {
    if (body.md) { const r = saveMd(dir, body.md); return jsonRes(r, r.error ? 409 : 200); }
    if (body.comment) return jsonRes({ comment: saveComment(dir, body.comment) });
    if (body.approve) { approveComment(dir, body.approve); return jsonRes({ ok: true }); }
    if (body.sendBack) { sendBackComment(dir, body.sendBack.id, body.sendBack.text); return jsonRes({ ok: true }); }
    if (body.decide) return jsonRes({ comment: decideScene(dir, body.decide) });
    if (body.voice) { pickVoice(dir, body.voice); return jsonRes({ ok: true }); }
    if (body.remove) { removeComment(dir, body.remove); return jsonRes({ ok: true }); }
    if (body.trim) return jsonRes(await trimClip(dir, body.trim));
    if (body.mute) return jsonRes(await muteTrack(dir, body.mute));
    if (body.restore) return jsonRes(restoreEdit(dir, body.restore));
    if (body.export) { startExport(dir, body.export); return jsonRes({ ok: true }); }
  } catch (e) {
    return jsonRes({ error: String(e.message || e) }, 400);
  }
  return jsonRes({ error: 'nothing to do' }, 400);
});
