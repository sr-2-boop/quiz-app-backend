import * as participants from '../../services/participant.service.js';

export async function list(req, res) {
  res.json(await participants.listParticipants(req.query));
}

export async function sections(_req, res) {
  res.json({ sections: await participants.listSections() });
}

export async function importRoster(req, res) {
  res.json(await participants.importRoster(req.file, { mode: req.query.mode }));
}

export async function update(req, res) {
  res.json({ participant: await participants.updateParticipant(req.params.id, req.body) });
}

export async function endSession(req, res) {
  await participants.endParticipantSession(req.params.id);
  res.status(204).end();
}
