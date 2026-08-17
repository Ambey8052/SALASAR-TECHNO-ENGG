import { Target } from '../models/Target.js';

export async function listTargets(req, res) {
  const targets = await Target.find().lean();
  res.json(targets.map((t) => ({ client: t.client, qty: t.qty, setByEmail: t.setByEmail, updatedAt: t.updatedAt })));
}

export async function upsertTarget(req, res) {
  const { client, qty } = req.body;
  if (!client || typeof qty !== 'number' || qty < 0) {
    return res.status(400).json({ error: 'client and a non-negative qty are required' });
  }

  const target = await Target.findOneAndUpdate(
    { client },
    { client, qty, setByEmail: req.user.email },
    { upsert: true, returnDocument: 'after' },
  );
  res.json({ client: target.client, qty: target.qty, setByEmail: target.setByEmail, updatedAt: target.updatedAt });
}

export async function deleteTarget(req, res) {
  await Target.deleteOne({ client: req.params.client });
  res.json({ ok: true });
}
