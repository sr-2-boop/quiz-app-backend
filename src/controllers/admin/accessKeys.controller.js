import * as accessKeys from '../../services/accessKey.service.js';

export async function list(_req, res) {
  res.json({ accessKeys: await accessKeys.listAccessKeys() });
}

export async function create(req, res) {
  res.status(201).json(await accessKeys.createAccessKey(req.body, req.user.email));
}

export async function rotate(req, res) {
  res.json(await accessKeys.rotateAccessKey(req.params.id, req.body));
}

export async function update(req, res) {
  res.json({ accessKey: await accessKeys.updateAccessKey(req.params.id, req.body) });
}

export async function deactivate(req, res) {
  res.json({ accessKey: await accessKeys.deactivateAccessKey(req.params.id) });
}
