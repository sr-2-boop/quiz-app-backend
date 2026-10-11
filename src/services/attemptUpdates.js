// Aggregation-pipeline fragments for atomic Attempt updates.
// Values from requests are always wrapped in $literal so strings starting with "$" stay data.

/** Recompute the attempt score from its answers in the same atomic update. */
export const RECOMPUTE_SCORE = {
  $set: {
    score: { $round: [{ $sum: '$answers.marksAwarded' }, 2] },
    updatedAt: '$$NOW',
  },
};

/** Replace (or add) the answer for `questionId`. */
export function upsertAnswerStage(questionId, answer) {
  return {
    $set: {
      answers: {
        $concatArrays: [
          { $filter: { input: '$answers', as: 'a', cond: { $ne: ['$$a.questionId', questionId] } } },
          [{ $literal: answer }],
        ],
      },
    },
  };
}

/** Merge `patch` into the answer for `questionId`, only while that answer is still pending. */
export function patchPendingAnswerStage(questionId, patch) {
  return {
    $set: {
      answers: {
        $map: {
          input: '$answers',
          as: 'a',
          in: {
            $cond: [
              { $and: [{ $eq: ['$$a.questionId', questionId] }, { $eq: ['$$a.status', 'pending'] }] },
              { $mergeObjects: ['$$a', { $literal: patch }] },
              '$$a',
            ],
          },
        },
      },
    },
  };
}
