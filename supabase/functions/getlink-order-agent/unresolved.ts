export type UnresolvedDraftReason=
  |"not_in_catalog"
  |"ambiguous"
  |"size_mismatch"
  |"needs_owner_confirmation"
  |"other";

export type UnresolvedDraftStatus="pending"|"resolved"|"dismissed";

export type UnresolvedDraftLine={
  id?:string;
  lineKey:string;
  sourceMessageId?:string|null;
  rawText:string;
  rawProductText:string;
  quantity:number|null;
  unitHint:string|null;
  contextFamily:string|null;
  candidateProductCodes:string[];
  reason:UnresolvedDraftReason;
  status:UnresolvedDraftStatus;
  resolvedProductCode:string|null;
};
