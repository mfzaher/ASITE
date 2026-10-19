export type AsiteRegion = "uae";
export type AsiteAuthType = "session" | "oauth";

/** Session REST uses Workspace_Id; the OAuth connector uses cloudUrl. */
export interface Project {
  id: string;
  name: string;
}

export interface Folder {
  id: string;
  name: string;
  path: string;
  parentId?: string;
  isE1: boolean;
}

/** Optional revision/status fields describe metadata, never an inferred history. */
export interface AsiteFile {
  id: string;
  name: string;
  folderId: string;
  folderPath: string;
  revision?: string;
  status?: string;
  downloadable: boolean;
  downloadUrl?: string;
}
