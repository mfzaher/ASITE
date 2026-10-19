import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { AsiteError, listFiles, listFolders, loginSession } from "../src/lib/asite";

// These are synthetic compatibility fixtures, not captured account responses.
const token = "test-only-fake-session+value=";
const project = "388$$fakeProject";
const folder = "101$$fakeE1Folder";
const child = "102$$fakeChildFolder";
const marker = "PRIVATE_SCALAR_MARKER_DO_NOT_REFLECT";
const urlOf = (input: string | URL | Request) => new URL(input instanceof Request ? input.url : input);
const pathname = (input: string | URL | Request) => urlOf(input).pathname.split("/").map(decodeURIComponent).join("/");
const json = (body: unknown) => Response.json(body);
const xml = (body: string) => new Response(body, { headers: { "Content-Type": "application/xml" } });
const folderPayload = () => ({ asiteDataList: { folderVO: { FolderID: folder, FolderName: "E1 Schedule" } } });
const downloadUrl = (revision: string) => `https://dmsuae.asite.com/api/workspace/${project}/folder/${folder}/downloadDocument/${revision}`;

afterEach(() => mock.restoreAll());

function checkError(error: unknown, code: string): error is AsiteError {
  assert.ok(error instanceof AsiteError);
  assert.equal(error.code, code);
  assert.equal(JSON.stringify(error).includes(marker), false);
  assert.equal(error.message.includes(marker), false);
  assert.equal(JSON.stringify(error).includes(token), false);
  return true;
}

test("session folder/document requests use XML and read two XML pages with singleton and repeated URIs", async () => {
  const paths: string[] = [];
  mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const path = pathname(input);
    paths.push(path);
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("accept"), "application/xml");
    assert.equal(headers.get("cookie"), `ASessionID=${token}`);
    assert.equal(headers.get("authorization"), null);
    assert.equal(urlOf(input).hostname, "dmsuae.asite.com");
    if (path.endsWith("/folders")) return xml(`<asiteDataList><folderVO><FolderID>${folder}</FolderID><FolderName>E1 Schedule</FolderName><folderVO/></folderVO></asiteDataList>`);
    if (path.endsWith("/firstpage_doclist")) return xml(`<?xml version="1.0"?><asiteDataList>
      <URI>https://dmsuae.asite.com/api/workspace/${project}/folder/nextpage_doclist/555/2</URI>
      <documentVO CheckoutStatus="No"><FolderId>${folder}</FolderId><FileName>Shop Drawing 1.xlsx</FileName><DocumentId>1$$fakeDoc</DocumentId><RevisionId>1$$fakeRevision</RevisionId><RevNo>00</RevNo><DocStatus>Approved</DocStatus>
        <URI>https://dmsuae.asite.com/api/workspace/${project}/folder/${folder}/commentinfo/1$$fakeDoc</URI><URI>${downloadUrl("1$$fakeRevision")}</URI>
      </documentVO></asiteDataList>`);
    assert.ok(path.endsWith("/nextpage_doclist/555/2"));
    return xml(`<asiteDataList>
      <documentVO><FolderId>${folder}</FolderId><FileName>Shop Drawing 2.xlsx</FileName><DocumentId>2$$fakeDoc</DocumentId><RevisionId>2$$fakeRevision</RevisionId><URI>${downloadUrl("2$$fakeRevision")}</URI></documentVO>
      <documentVO><FolderId>${folder}</FolderId><FileName>View Only.xlsx</FileName><DocumentId>3$$fakeDoc</DocumentId><RevisionId>3$$fakeRevision</RevisionId></documentVO>
    </asiteDataList>`);
  });
  const files = await listFiles(token, "uae", project, [folder]);
  assert.equal(paths.length, 3);
  assert.equal(files.length, 3);
  assert.equal(files[0].downloadUrl, downloadUrl("1$$fakeRevision"));
  assert.equal(files[0].revision, "00");
  assert.equal(files[1].downloadable, true);
  assert.equal(files[2].downloadable, false);
});

test("session login accepts namespace-prefixed XML UserProfile and Sessionid", async () => {
  mock.method(globalThis, "fetch", async () => xml(`<?xml version="1.0"?><a:UserProfile xmlns:a="urn:asite:test"><a:Sessionid>${token}</a:Sessionid></a:UserProfile>`));
  assert.deepEqual(await loginSession("person@example.com", "fake-password", "uae"), { token });
});

test("documented XML invalid-credential exception becomes a clear login failure without reflecting descriptions", async () => {
  mock.method(globalThis, "fetch", async () => xml(`<AsiteAPIExceptionThrown><ERROR_MESSAGE>invalidCredentials</ERROR_MESSAGE><ERROR_DESCRIPTION>${marker}</ERROR_DESCRIPTION></AsiteAPIExceptionThrown>`));
  await assert.rejects(loginSession("person@example.com", "fake-password", "uae"), (error: unknown) => checkError(error, "LOGIN_FAILED"));
});

test("known expired-session errors in XML or the data envelope cannot become successful empty folder scans", async () => {
  for (const payload of [
    `<AsiteAPIExceptionThrown><ERROR_MESSAGE>sessionExpired</ERROR_MESSAGE><ERROR_DESCRIPTION>${marker}</ERROR_DESCRIPTION></AsiteAPIExceptionThrown>`,
    { asiteDataList: { errorCode: "sessionExpired", errorMessage: "Session expired", errorDescription: marker, folderVO: null } },
  ]) {
    mock.method(globalThis, "fetch", async () => typeof payload === "string" ? xml(payload) : json(payload));
    await assert.rejects(listFolders(token, "uae", project), (error: unknown) => checkError(error, "SESSION_EXPIRED"));
    mock.restoreAll();
  }
});

test("HTML returned to session login reports an unavailable login method without asserting confirmed SSO", async () => {
  mock.method(globalThis, "fetch", async () => new Response(`<html><body>${marker}</body></html>`, { headers: { "Content-Type": "text/html" } }));
  await assert.rejects(loginSession("person@example.com", "fake-password", "uae"), (error: unknown) => {
    checkError(error, "LOGIN_METHOD_UNAVAILABLE");
    assert.equal(/requires SSO|SSO is required|SSO-only/i.test((error as AsiteError).message), false);
    return true;
  });
});

test("folder parsing accepts namespaced XML and known casing/underscore aliases with empty child collections", async () => {
  for (const payload of [
    `<a:asiteDataList xmlns:a="urn:asite:test"><a:folderVO><a:FolderID>${folder}</a:FolderID><a:FolderName>E1 Schedule</a:FolderName><a:folderVO><a:FolderID>${child}</a:FolderID><a:FolderName>Current</a:FolderName><a:ParentFolderID>${folder}</a:ParentFolderID><a:folderVO/></a:folderVO></a:folderVO></a:asiteDataList>`,
    { asite_data_list: { Folder_VO: { folder_id: folder, folder_name: "E1 Schedule", FOLDER_VO: { FOLDER_ID: child, FOLDER_NAME: "Current", parent_folder_id: folder, folder_vo: null } } } },
  ]) {
    mock.method(globalThis, "fetch", async () => typeof payload === "string" ? xml(payload) : json(payload));
    const folders = await listFolders(token, "uae", project);
    assert.equal(folders.length, 2);
    assert.equal(folders.find((item) => item.id === child)?.path, "E1 Schedule/Current");
    assert.equal(folders.find((item) => item.id === child)?.isE1, true);
    mock.restoreAll();
  }
});

test("explicit empty folder/document collections are distinct from missing collections", async () => {
  for (const empty of [null, "", []]) {
    mock.method(globalThis, "fetch", async () => json({ asiteDataList: { folderVO: empty } }));
    assert.deepEqual(await listFolders(token, "uae", project), []);
    mock.restoreAll();
    mock.method(globalThis, "fetch", async (input: string | URL | Request) => pathname(input).endsWith("/folders") ? json(folderPayload()) : json({ asiteDataList: { documentVO: empty } }));
    assert.deepEqual(await listFiles(token, "uae", project, [folder]), []);
    mock.restoreAll();
  }
});

test("absent collections fail with bounded shape-only diagnostics that redact values and unknown key names", async () => {
  const payload = { asiteDataList: { FileName: marker, URI: `https://example.invalid/?credential=${marker}`, [marker]: { value: marker } }, [token]: marker };
  mock.method(globalThis, "fetch", async () => json(payload));
  await assert.rejects(listFolders(token, "uae", project), (error: unknown) => {
    checkError(error, "INVALID_RESPONSE");
    assert.ok("diagnostic" in (error as AsiteError));
    const diagnostic = (error as AsiteError & { diagnostic: Record<string, unknown> }).diagnostic;
    assert.ok(diagnostic && typeof diagnostic === "object");
    assert.equal(typeof diagnostic.operation, "string");
    assert.equal(typeof diagnostic.format, "string");
    assert.equal(diagnostic.httpStatus, 200);
    assert.ok("contentType" in diagnostic);
    assert.ok("rootKeys" in diagnostic);
    assert.ok("dataKeys" in diagnostic);
    const text = JSON.stringify(diagnostic);
    assert.equal(text.includes(marker), false);
    assert.equal(text.includes(token), false);
    assert.equal(text.includes("https://"), false);
    assert.ok(text.length <= 4096);
    return true;
  });
  mock.restoreAll();
  mock.method(globalThis, "fetch", async (input: string | URL | Request) => pathname(input).endsWith("/folders") ? json(folderPayload()) : json(payload));
  await assert.rejects(listFiles(token, "uae", project, [folder]), (error: unknown) => checkError(error, "INVALID_RESPONSE"));
});

test("ambiguous casing/underscore aliases fail instead of choosing an arbitrary collection or resource ID", async () => {
  for (const payload of [
    { asiteDataList: { folderVO: [], Folder_VO: { FolderID: folder, FolderName: "E1 Schedule" } } },
    { asiteDataList: { folderVO: { FolderID: folder, folder_id: child, FolderName: "E1 Schedule" } } },
  ]) {
    mock.method(globalThis, "fetch", async () => json(payload));
    await assert.rejects(listFolders(token, "uae", project), (error: unknown) => checkError(error, "INVALID_RESPONSE"));
    mock.restoreAll();
  }
});

test("document aliases and JAXB URI text objects retain approved-host download validation", async () => {
  const document = {
    folder_id: folder, FILE_NAME: "Shop Drawing.xlsx", document_id: "1$$fakeDoc", revision_id: "1$$fakeRevision",
    rev_no: "P02", doc_status: "Approved", uri: { "#text": downloadUrl("1$$fakeRevision") },
  };
  mock.method(globalThis, "fetch", async (input: string | URL | Request) => pathname(input).endsWith("/folders") ? json(folderPayload()) : json({ asite_data_list: { Document_VO: document } }));
  const files = await listFiles(token, "uae", project, [folder]);
  assert.equal(files.length, 1);
  assert.equal(files[0].downloadUrl, downloadUrl("1$$fakeRevision"));
  assert.equal(files[0].revision, "P02");
  assert.equal(files[0].status, "Approved");
  mock.restoreAll();
  const hosts: string[] = [];
  mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    hosts.push(urlOf(input).hostname);
    return pathname(input).endsWith("/folders") ? json(folderPayload()) : json({ asiteDataList: { documentVO: { ...document, uri: { "#text": `https://attacker.example/api/workspace/${project}/folder/${folder}/downloadDocument/1$$fakeRevision` } } } });
  });
  await assert.rejects(listFiles(token, "uae", project, [folder]), (error: unknown) => checkError(error, "UNSAFE_URL"));
  assert.deepEqual(hosts, ["dmsuae.asite.com", "dmsuae.asite.com"]);
});

test("a malformed entry mixed into an XML document list fails without returning partial results", async () => {
  mock.method(globalThis, "fetch", async (input: string | URL | Request) => pathname(input).endsWith("/folders") ? json(folderPayload()) : xml(`<asiteDataList>
    <documentVO><FolderId>${folder}</FolderId><FileName>Shop Drawing.xlsx</FileName><DocumentId>1$$fakeDoc</DocumentId><RevisionId>1$$fakeRevision</RevisionId></documentVO>
    <documentVO>${marker}</documentVO></asiteDataList>`));
  await assert.rejects(listFiles(token, "uae", project, [folder]), (error: unknown) => checkError(error, "INVALID_RESPONSE"));
});

test("malformed XML cannot leak parser body snippets through errors or diagnostics", async () => {
  mock.method(globalThis, "fetch", async () => xml(`<asiteDataList><folderVO>${marker}</asiteDataList>`));
  await assert.rejects(listFolders(token, "uae", project), (error: unknown) => checkError(error, "INVALID_RESPONSE"));
});

test("login HTTP 401 and redirects report sign-in failures without an established-session claim", async () => {
  mock.method(globalThis, "fetch", async () => new Response(marker, {status:401}));
  await assert.rejects(loginSession("person@example.com", "fake-password", "uae"), (error: unknown) => checkError(error, "LOGIN_FAILED"));
  mock.restoreAll();
  mock.method(globalThis, "fetch", async () => new Response(marker, {status:302,headers:{Location:"https://example.invalid/ssologin"}}));
  await assert.rejects(loginSession("person@example.com", "fake-password", "uae"), (error: unknown) => checkError(error, "LOGIN_METHOD_UNAVAILABLE"));
});

test("expiry in an error code is recognised and explicit success metadata does not reject a folder tree", async () => {
  mock.method(globalThis, "fetch", async () => json({asiteDataList:{errorCode:"sessionExpired",errorMessage:"",folderVO:null}}));
  await assert.rejects(listFolders(token, "uae", project), (error: unknown) => checkError(error, "SESSION_EXPIRED"));
  mock.restoreAll();
  mock.method(globalThis, "fetch", async () => json({asiteDataList:{errorCode:0,errorMessage:"Success",folderVO:{FolderID:folder,FolderName:"E1 Schedule"}}}));
  assert.equal((await listFolders(token, "uae", project)).length,1);
});
