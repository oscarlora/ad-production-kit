// An ad's edit, or a brand page's (inputs: true in place of ad: only md, the comment actions and looks: the brand's saved text styles, saveLooks). Body: { ad (its folder
// name), and one action }: md (saveMd; 409 when it can't merge), comment (saveComment),
// approve: id, sendBack: { id, text }, decide (decideScene), voice: take (pickVoice), render: drafts/ or final/ image (moveRender), remove: id, save (saveEdit) or
// export: plan (startExport). Each is described in lib/server/edit.js.
import { adDir, approveComment, decideScene, moveRender, pickVoice, removeComment, saveEdit, saveLooks, saveMd, saveComment, sendBackComment, startExport } from '../../../../../lib/server/edit.js';
import { brandPost, jsonRes } from '../../../../../lib/server/http.js';
import { inputsDir } from '../../../../../lib/server/pages.js';

export const POST = brandPost(async (req, ctx) => {
  const body = await req.json().catch(() => ({}));
  const dir = body.inputs ? inputsDir(ctx.dir) : adDir(ctx.dir, body.ad);
  if (!dir) return jsonRes({ error: 'no such ad folder' }, 404);
  try {
    if (body.md) { const r = saveMd(dir, body.md); return jsonRes(r, r.error ? 409 : 200); }
    if (body.comment) return jsonRes({ comment: saveComment(dir, body.comment) });
    if (body.approve) { approveComment(dir, body.approve); return jsonRes({ ok: true }); }
    if (body.sendBack) { sendBackComment(dir, body.sendBack.id, body.sendBack.text); return jsonRes({ ok: true }); }
    if (body.remove) { removeComment(dir, body.remove); return jsonRes({ ok: true }); }
    if (body.inputs && body.looks) return jsonRes(saveLooks(dir, body.looks, body.kind));
    if (body.inputs) return jsonRes({ error: 'a page takes only md, comment and looks actions' }, 400);
    if (body.decide) return jsonRes({ comment: decideScene(dir, body.decide) });
    if (body.voice) { pickVoice(dir, body.voice); return jsonRes({ ok: true }); }
    if (body.render) return jsonRes(moveRender(dir, body.render));
    if (body.save) return jsonRes(await saveEdit(dir, body.save));
    if (body.export) { startExport(dir, body.export); return jsonRes({ ok: true }); }
  } catch (e) {
    return jsonRes({ error: String(e.message || e) }, 400);
  }
  return jsonRes({ error: 'nothing to do' }, 400);
});
