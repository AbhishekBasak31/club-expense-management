import express from "express";
import {
  createPartyQuery, getPartyQueries, getPartyQueryById, updatePartyQuery,
  updatePartyQueryStatus, updateAdvance, saveRfp, updateRfpStatus, sendRfp,
} from "../Controller/PartyQuery.controller.js";
import { authenticate } from "../../src/Middleware/auth.middleware.js";
import { asyncHandler } from "../../src/Utils/Asynchandeler.js";

const PartyQueryRouter = express.Router();
PartyQueryRouter.use(authenticate);

PartyQueryRouter.post  ("/",               asyncHandler(createPartyQuery));
PartyQueryRouter.get   ("/",               asyncHandler(getPartyQueries));
PartyQueryRouter.get   ("/:id",            asyncHandler(getPartyQueryById));
PartyQueryRouter.put   ("/:id",            asyncHandler(updatePartyQuery));
PartyQueryRouter.put   ("/:id/status",     asyncHandler(updatePartyQueryStatus)); // accept / reject
PartyQueryRouter.put   ("/:id/advance",    asyncHandler(updateAdvance));
PartyQueryRouter.put   ("/:id/rfp",        asyncHandler(saveRfp));               // create or edit the RFP draft
PartyQueryRouter.put   ("/:id/rfp/status", asyncHandler(updateRfpStatus));       // approve / reject the RFP
PartyQueryRouter.post  ("/:id/rfp/send",   asyncHandler(sendRfp));               // email it to the client

export default PartyQueryRouter;