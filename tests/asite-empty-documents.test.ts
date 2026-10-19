import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { AsiteError, listFiles, listFolders } from "../src/lib/asite";

// Synthetic fixtures for Asite's XML serialization of an empty document folder.
const token = "fake-empty-documents-session+value=";
const project = "388$$fakeProject";
const parent = "101$$fakeE1Folder";
const descendant = "102$$fakeRegisterFolder";
const marker = "PRIVATE_EMPTY_RESPONSE_MARKER";
const xml = (body: string) => new Response(body, { headers: { "Content-Type": "application/xml" } });
const urlOf = (input: string | URL | Request) => new URL(input instanceof Request ? input.url : input);
const pathname = (input: string | URL | Request) => urlOf(input).pathname.split("/").map(decodeURIComponent).join("/");

const folderTree = `<asiteDataList><folderVO><FolderID>${parent}</FolderID><FolderName>E1 Schedule</FolderName><folderVO><FolderID>${descendant}</FolderID><FolderName>Shop Registers</FolderName><ParentFolderID>${parent}</ParentFolderID></folderVO></folderVO></asiteDataList>`;

function document(folderId: string): string {
  return `<documentVO><FolderId>${folderId}</FolderId><FileName>E1 Shop Register.xlsx</FileName><DocumentId>1$$fakeDoc</DocumentId><RevisionId>1$$fakeRevision</RevisionId><RevNo>00</RevNo><DocStatus>Approved</DocStatus><URI>https://dmsuae.asite.com/api/workspace/${project}/folder/${folderId}/downloadDocument/1$$fakeRevision</URI></documentVO>`;
}

function safeFailure(error: unknown, code: string): error is AsiteError {
  assert.ok(error instanceof AsiteError);
  assert.equal(error.code, code);
  assert.equal(error.message.includes(marker), false);
  assert.equal(JSON.stringify(error).includes(marker), false);
  assert.equal(JSON.stringify(error).includes(token), false);
  return true;
}

afterEach(() => mock.restoreAll());

test("empty XML data roots are valid document lists only, including whitespace and namespace attributes", async () => {
  const emptyRoots = [
    "<asiteDataList/>",
    "<asiteDataList></asiteDataList>",
    "<asiteDataList> \n\t </asiteDataList>",
    '<?xml version="1.0"?><a:asiteDataList xmlns:a="urn:asite:test"/>',
    '<asiteDataList xmlns="urn:asite:test"></asiteDataList>',
  ];
  for (const empty of emptyRoots) {
    mock.method(globalThis, "fetch", async (input: string | URL | Request) => pathname(input).endsWith("/folders") ? xml(folderTree) : xml(empty));
    assert.deepEqual(await listFiles(token, "uae", project, [parent]), []);
    mock.restoreAll();
    mock.method(globalThis, "fetch", async () => xml(empty));
    await assert.rejects(listFolders(token, "uae", project), (error: unknown) => safeFailure(error, "INVALID_RESPONSE"));
    mock.restoreAll();
  }
});

test("an empty E1 parent does not stop discovery in a selected descendant containing a register", async () => {
  const paths: string[] = [];
  mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const path = pathname(input);
    paths.push(path);
    assert.equal(new Headers(init?.headers).get("accept"), "application/xml");
    if (path.endsWith("/folders")) return xml(folderTree);
    if (path.includes(`/folder/${parent}/`)) return xml("<asiteDataList/>");
    assert.ok(path.includes(`/folder/${descendant}/firstpage_doclist`));
    return xml(`<asiteDataList>${document(descendant)}</asiteDataList>`);
  });
  const files = await listFiles(token, "uae", project, [parent, descendant]);
  assert.equal(paths.length, 3);
  assert.equal(files.length, 1);
  assert.equal(files[0].name, "E1 Shop Register.xlsx");
  assert.equal(files[0].folderId, descendant);
  assert.equal(files[0].folderPath, "E1 Schedule/Shop Registers");
  assert.equal(files[0].downloadable, true);
});

test("an empty final pagination page preserves registers already returned by the first page", async () => {
  const paths: string[] = [];
  mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const path = pathname(input);
    paths.push(path);
    if (path.endsWith("/folders")) return xml(folderTree);
    if (path.endsWith("/firstpage_doclist")) return xml(`<asiteDataList>${document(parent)}<URI>https://dmsuae.asite.com/api/workspace/${project}/folder/nextpage_doclist/777/2</URI></asiteDataList>`);
    assert.ok(path.endsWith("/nextpage_doclist/777/2"));
    return xml("<asiteDataList></asiteDataList>");
  });
  const files = await listFiles(token, "uae", project, [parent]);
  assert.equal(paths.length, 3);
  assert.equal(files.length, 1);
  assert.equal(files[0].id, "1$$fakeDoc:1$$fakeRevision");
});

test("explicit JSON documentVO empty arrays remain valid and a lone empty parent returns no files", async () => {
  let requests = 0;
  mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    requests++;
    return pathname(input).endsWith("/folders") ? xml(folderTree) : Response.json({ asiteDataList: { documentVO: [] } });
  });
  assert.deepEqual(await listFiles(token, "uae", project, [parent]), []);
  assert.equal(requests, 2);
});

test("nonempty text, unknown elements, missing roots, and blank bodies are not successful empty document lists", async () => {
  for (const body of [
    `<asiteDataList>${marker}</asiteDataList>`,
    `<asiteDataList><unknownElement>${marker}</unknownElement></asiteDataList>`,
    "<otherRoot/>",
    " \n\t ",
  ]) {
    mock.method(globalThis, "fetch", async (input: string | URL | Request) => pathname(input).endsWith("/folders") ? xml(folderTree) : xml(body));
    await assert.rejects(listFiles(token, "uae", project, [parent]), (error: unknown) => safeFailure(error, "INVALID_RESPONSE"));
    mock.restoreAll();
  }
});

test("known API errors with empty document data still fail rather than reporting a zero-file scan", async () => {
  for (const payload of [
    `<asiteDataList><errorCode>sessionExpired</errorCode><errorMessage>Session expired</errorMessage><errorDescription>${marker}</errorDescription><documentVO/></asiteDataList>`,
    { asiteDataList: { errorCode: "sessionExpired", errorMessage: "Session expired", errorDescription: marker, documentVO: [] } },
    `<AsiteAPIExceptionThrown><ERROR_MESSAGE>sessionExpired</ERROR_MESSAGE><ERROR_DESCRIPTION>${marker}</ERROR_DESCRIPTION></AsiteAPIExceptionThrown>`,
  ]) {
    mock.method(globalThis, "fetch", async (input: string | URL | Request) => pathname(input).endsWith("/folders") ? xml(folderTree) : typeof payload === "string" ? xml(payload) : Response.json(payload));
    await assert.rejects(listFiles(token, "uae", project, [parent]), (error: unknown) => safeFailure(error, "SESSION_EXPIRED"));
    mock.restoreAll();
  }
});
