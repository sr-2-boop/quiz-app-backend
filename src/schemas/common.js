import { z } from 'zod';

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'must be a valid id');

export const idParams = z.strictObject({ id: objectId });

export const dateInput = z.coerce.date();

export const nullableDate = z.union([z.null(), dateInput]);

/** Query-string boolean: "true"/"false". */
export const queryBool = z.enum(['true', 'false']).transform((v) => v === 'true');
