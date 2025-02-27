import * as assert from "assert";
import * as os from "os";
import * as path from "path";
import * as sinon from "sinon";
import * as vs from "vscode";
import { debugAnywayAction, showErrorsAction } from "../../../shared/constants";
import { DebuggerType } from "../../../shared/enums";
import { versionIsAtLeast } from "../../../shared/utils";
import { faint } from "../../../shared/utils/colors";
import { fsPath, getRandomInt } from "../../../shared/utils/fs";
import { resolvedPromise } from "../../../shared/utils/promises";
import { DartDebugClient } from "../../dart_debug_client";
import { createDebugClient, disableDdsForTestForWindows, ensureFrameCategories, ensureMapEntry, ensureNoVariable, ensureVariable, ensureVariableWithIndex, getVariablesTree, isExternalPackage, isLocalPackage, isSdkFrame, isUserCode, spawnDartProcessPaused, startDebugger, waitAllThrowIfTerminates } from "../../debug_helpers";
import { activate, breakpointFor, closeAllOpenFiles, defer, delay, ensureArrayContainsArray, extApi, getAttachConfiguration, getDefinition, getLaunchConfiguration, getPackages, getResolvedDebugConfiguration, helloWorldBrokenFile, helloWorldDeferredEntryFile, helloWorldDeferredScriptFile, helloWorldExampleSubFolder, helloWorldExampleSubFolderMainFile, helloWorldFolder, helloWorldGettersFile, helloWorldGoodbyeFile, helloWorldHttpFile, helloWorldInspectionFile as helloWorldInspectFile, helloWorldLocalPackageFile, helloWorldLongRunningFile, helloWorldMainFile, helloWorldPartEntryFile, helloWorldPartFile, helloWorldStack60File, helloWorldThrowInExternalPackageFile, helloWorldThrowInLocalPackageFile, helloWorldThrowInSdkFile, openFile, positionOf, sb, setConfigForTest, uriFor, waitForResult, watchPromise, writeBrokenDartCodeIntoFileForTest } from "../../helpers";


describe("dart cli debugger", () => {
	// We have tests that require external packages.
	before("get packages", () => getPackages());
	beforeEach("activate helloWorldMainFile", () => activate(helloWorldMainFile));

	beforeEach("disable DDS for Windows", disableDdsForTestForWindows);

	let dc: DartDebugClient;
	beforeEach("create debug client", () => {
		dc = createDebugClient(DebuggerType.Dart);
	});

	async function attachDebugger(vmServiceUri: string | undefined, extraConfiguration?: { [key: string]: any }): Promise<vs.DebugConfiguration | undefined | null> {
		const config = await getAttachConfiguration(Object.assign({ vmServiceUri }, extraConfiguration));
		if (!config)
			throw new Error(`Could not get launch configuration (got ${config})`);
		await dc.start();
		return config;
	}

	describe("resolves the correct debug config", () => {

		it("passing launch.json's toolArgs to the VM", async () => {
			const resolvedConfig = await getResolvedDebugConfiguration({
				program: fsPath(helloWorldMainFile),
				toolArgs: ["--fake-flag"],
			})!;

			assert.ok(resolvedConfig);
			assert.equal(resolvedConfig.program, fsPath(helloWorldMainFile));
			assert.equal(resolvedConfig.cwd, fsPath(helloWorldFolder));
			ensureArrayContainsArray(resolvedConfig.toolArgs!, ["--fake-flag"]);
		});

	});


	it("runs to completion", async () => {
		const config = await startDebugger(dc, helloWorldMainFile);
		await waitAllThrowIfTerminates(dc,
			dc.configurationSequence(),
			dc.waitForEvent("terminated"),
			dc.launch(config),
		);
	});

	describe("prompts the user if trying to run with errors", () => {
		function getTempProjectFile() {
			const fileName = `temp-${getRandomInt(0x1000, 0x10000).toString(16)}.dart`;
			return vs.Uri.file(path.join(fsPath(helloWorldFolder), "bin", fileName));
		}
		function getTempTestFile() {
			const fileName = `temp-${getRandomInt(0x1000, 0x10000).toString(16)}.dart`;
			return vs.Uri.file(path.join(fsPath(helloWorldFolder), "test", fileName));
		}
		it("and cancels launch if they click Show Errors", async () => {
			await writeBrokenDartCodeIntoFileForTest(getTempProjectFile());

			const showErrorMessage = sb.stub(vs.window, "showErrorMessage");
			showErrorMessage.resolves(showErrorsAction);

			const config = await getLaunchConfiguration(helloWorldMainFile);

			// Since we clicked Show Errors, we expect the resolved config to be undefined, since
			// launch will have been aborted.
			assert.strictEqual(config, undefined);
			assert(showErrorMessage.calledOnce);
		});
		it("and launches if they click Debug Anyway", async () => {
			await writeBrokenDartCodeIntoFileForTest(getTempProjectFile());

			const showErrorMessage = sb.stub(vs.window, "showErrorMessage");
			showErrorMessage.resolves(debugAnywayAction);

			const config = await startDebugger(dc, helloWorldMainFile);

			// If we got a debug config, then we will launch normally.
			assert(config);
			assert(showErrorMessage.calledOnce);

			await waitAllThrowIfTerminates(dc,
				dc.configurationSequence(),
				dc.assertOutput("stdout", "Hello, world!"),
				dc.waitForEvent("terminated"),
				dc.launch(config),
			);
		});
		it("unless the errors are in test scripts", async () => {
			await writeBrokenDartCodeIntoFileForTest(getTempTestFile());

			const showErrorMessage = sb.stub(vs.window, "showErrorMessage");
			showErrorMessage.resolves(debugAnywayAction);

			const config = await startDebugger(dc, helloWorldMainFile);

			// Although we have errors, they're in test scripts, so we expect
			// them to be ignored.
			assert(config);
			assert(!showErrorMessage.calledOnce);

			await waitAllThrowIfTerminates(dc,
				dc.configurationSequence(),
				dc.assertOutput("stdout", "Hello, world!"),
				dc.waitForEvent("terminated"),
				dc.launch(config),
			);
		});
		it("in the test script being run", async () => {
			const tempTestScript = getTempProjectFile();
			await writeBrokenDartCodeIntoFileForTest(tempTestScript);

			const showErrorMessage = sb.stub(vs.window, "showErrorMessage");
			showErrorMessage.resolves(showErrorsAction);

			const config = await getLaunchConfiguration(tempTestScript);

			// Since the error is in the test script we're running, we expect the prompt.
			assert.strictEqual(config, undefined);
			assert(showErrorMessage.calledOnce);
		});
	});

	it("receives the expected output", async () => {
		const config = await startDebugger(dc, helloWorldMainFile);
		await waitAllThrowIfTerminates(dc,
			dc.configurationSequence(),
			dc.assertOutput("stdout", "Hello, world!"),
			dc.assertOutputContains("console", `${faint("[log] ")}Logging from dart:developer!`),
			dc.assertOutputContains("console", "<<end_of_long_line>>"),
			dc.waitForEvent("terminated"),
			dc.launch(config),
		);
	});

	it("can run in a terminal", async () => {
		await openFile(helloWorldMainFile);
		const config = await startDebugger(dc, helloWorldMainFile, {
			console: "terminal",
			name: "dart-terminal-test",
		});

		// Stop at a breakpoint so the app won't quit while we're checking the terminal.
		await dc.hitBreakpoint(config, {
			line: positionOf("^// BREAKPOINT1").line + 1, // positionOf is 0-based, but seems to want 1-based
			path: fsPath(helloWorldMainFile),
		});

		// Ensure we have a terminal for it.
		await waitForResult(() => vs.window.terminals.find((t) => t.name === config.name) !== undefined);

		// Resume and wait for it to finish.
		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("terminated"),
			dc.resume(),
		);
	});

	it("resolves relative paths", async () => {
		const config = await getLaunchConfiguration(
			path.relative(fsPath(helloWorldFolder), fsPath(helloWorldMainFile)),
		);
		assert.equal(config!.program, fsPath(helloWorldMainFile));
	});

	it("resolves program as bin/main.dart if no file is open/provided", async () => {
		await closeAllOpenFiles();
		const config = await getLaunchConfiguration(undefined);
		assert.equal(config!.program, fsPath(helloWorldMainFile));
	});

	it("uses the launch config program regardless of what's open", async () => {
		await openFile(helloWorldMainFile);
		const config = await getLaunchConfiguration(helloWorldGoodbyeFile);
		assert.equal(config!.program, fsPath(helloWorldGoodbyeFile));
	});

	it("resolves program to the open script if no file is provided", async () => {
		await openFile(helloWorldGoodbyeFile);
		const config = await getLaunchConfiguration();
		assert.equal(config!.program, fsPath(helloWorldGoodbyeFile));
	});

	it("resolves project program/cwds in sub-folders when the open file is in a project sub-folder", async () => {
		await openFile(helloWorldExampleSubFolderMainFile);
		const config = await getLaunchConfiguration();
		assert.equal(config!.program, fsPath(helloWorldExampleSubFolderMainFile));
		assert.equal(config!.cwd, fsPath(helloWorldExampleSubFolder));
	});

	it("can run projects in sub-folders when cwd is set to a project sub-folder", async () => {
		await closeAllOpenFiles();
		const config = await getLaunchConfiguration(undefined, { cwd: "example" });
		assert.equal(config!.program, fsPath(helloWorldExampleSubFolderMainFile));
		assert.equal(config!.cwd, fsPath(helloWorldExampleSubFolder));
	});

	it("can launch DevTools externally", async () => {

		// TODO(dantup): Tests for embedded DevTools.
		await setConfigForTest("dart", "embedDevTools", false);

		const openBrowserCommand = sb.stub(extApi.envUtils, "openInBrowser").withArgs(sinon.match.any).resolves(true);

		await openFile(helloWorldMainFile);
		const config = await startDebugger(dc, helloWorldMainFile);
		// Stop at a breakpoint so the app won't quit while we're verifying DevTools.
		await dc.hitBreakpoint(config, {
			line: positionOf("^// BREAKPOINT1").line + 1, // positionOf is 0-based, but seems to want 1-based
			path: fsPath(helloWorldMainFile),
		});

		const devTools = await vs.commands.executeCommand("dart.openDevTools") as { url: string, dispose: () => void };
		assert.ok(openBrowserCommand.calledOnce);
		assert.ok(devTools);
		defer(devTools.dispose);
		assert.ok(devTools.url);

		const serverResponse = await extApi.webClient.fetch(devTools.url);
		assert.notEqual(serverResponse.indexOf("Dart DevTools"), -1);
	});

	it("stops at a breakpoint", async () => {
		await openFile(helloWorldMainFile);
		const config = await startDebugger(dc, helloWorldMainFile);
		await dc.hitBreakpoint(config, {
			line: positionOf("^// BREAKPOINT1").line + 1, // positionOf is 0-based, but seems to want 1-based
			path: fsPath(helloWorldMainFile),
		});
		const stack = await dc.getStack();
		const frames = stack.body.stackFrames;
		assert.equal(frames[0].name, "main");
		assert.equal(frames[0].source!.path, fsPath(helloWorldMainFile));
		assert.equal(frames[0].source!.name, path.relative(fsPath(helloWorldFolder), fsPath(helloWorldMainFile)));
	});

	it("does not stop at a breakpoint in noDebug mode", async () => {
		await openFile(helloWorldMainFile);
		const config = await startDebugger(dc, helloWorldMainFile);
		config.noDebug = true;
		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("terminated"),
			dc.setBreakpointWithoutHitting(config, {
				line: positionOf("^// BREAKPOINT1").line + 1, // positionOf is 0-based, but seems to want 1-based
				path: fsPath(helloWorldMainFile),
				verified: false,
			}),
		);
	});

	it("stops at a breakpoint in a part file", async () => {
		await openFile(helloWorldPartFile);
		const config = await startDebugger(dc, helloWorldPartEntryFile);
		await dc.hitBreakpoint(config, {
			line: positionOf("^// BREAKPOINT1").line,
			path: fsPath(helloWorldPartFile),
		});
		const stack = await dc.getStack();
		const frames = stack.body.stackFrames;
		assert.equal(frames[0].name, "do_print");
		assert.equal(frames[0].source!.path, fsPath(helloWorldPartFile));
		assert.equal(frames[0].source!.name, "package:hello_world/part.dart");
	});

	it("stops at a breakpoint in a deferred file", async () => {
		await openFile(helloWorldDeferredScriptFile);
		const config = await startDebugger(dc, helloWorldDeferredEntryFile);
		await dc.hitBreakpoint(config, {
			line: positionOf("^// BREAKPOINT1").line,
			path: fsPath(helloWorldDeferredScriptFile),
		});
		const stack = await dc.getStack();
		const frames = stack.body.stackFrames;
		assert.equal(frames[0].name, "do_print");
		assert.equal(frames[0].source!.path, fsPath(helloWorldDeferredScriptFile));
		assert.equal(frames[0].source!.name, "package:hello_world/deferred_script.dart");
	});

	// Known not to work; https://github.com/Dart-Code/Dart-Code/issues/821
	it.skip("stops at a breakpoint in the SDK", async () => {
		await openFile(helloWorldMainFile);
		// Get location for `print`
		const def = await getDefinition(positionOf("pri^nt("));
		const config = await startDebugger(dc, helloWorldMainFile);
		await dc.hitBreakpoint(config, breakpointFor(def));
		const stack = await dc.getStack();
		const frames = stack.body.stackFrames;
		assert.equal(frames[0].name, "print");
		assert.equal(frames[0].source!.path, fsPath(uriFor(def)));
		assert.equal(frames[0].source!.name, "dart:core/print.dart");
	});

	it("stops at a breakpoint in an external package", async () => {
		await openFile(helloWorldHttpFile);
		// Get location for `http.read`
		const def = await getDefinition(positionOf("http.re^ad"));
		const config = await startDebugger(dc, helloWorldHttpFile, { debugExternalLibraries: true });
		await dc.hitBreakpoint(config, breakpointFor(def));
		const stack = await dc.getStack();
		const frames = stack.body.stackFrames;
		assert.equal(frames[0].name, "read");
		assert.equal(frames[0].source!.path, fsPath(uriFor(def)));
		assert.equal(frames[0].source!.name, "package:http/http.dart");
	});

	it("steps into the SDK if debugSdkLibraries is true", async () => {
		await openFile(helloWorldMainFile);
		// Get location for `print`
		const printCall = positionOf("pri^nt(");
		const config = await startDebugger(dc, helloWorldMainFile, { debugSdkLibraries: true });
		await dc.hitBreakpoint(config, {
			line: printCall.line + 1,
			path: fsPath(helloWorldMainFile),
		});
		await waitAllThrowIfTerminates(dc,
			dc.assertStoppedLocation("step", {
				// SDK source will have no filename, because we download it
				path: undefined,
			}).then((response) => {
				// Ensure the top stack frame matches
				const frame = response.body.stackFrames[0];
				assert.equal(frame.name, "print");
				// We don't get a source path, because the source is downloaded from the VM
				assert.equal(frame.source!.path, undefined);
				assert.equal(frame.source!.name, "dart:core/print.dart");
			}),
			dc.stepIn(),
		);
	});

	it("steps into the SDK if debugSdkLibraries is enabled during the run", async () => {
		await openFile(helloWorldMainFile);
		// Get location for `print`
		const printCall = positionOf("pri^nt(");
		const config = await startDebugger(dc, helloWorldMainFile, { debugSdkLibraries: false });
		await dc.hitBreakpoint(config, {
			line: printCall.line + 1,
			path: fsPath(helloWorldMainFile),
		});
		await dc.customRequest("updateDebugOptions", { debugSdkLibraries: true });
		await delay(100);
		await waitAllThrowIfTerminates(dc,
			dc.assertStoppedLocation("step", {
				// SDK source will have no filename, because we download it
				path: undefined,
			}).then((response) => {
				// Ensure the top stack frame matches
				const frame = response.body.stackFrames[0];
				assert.equal(frame.name, "print");
				// We don't get a source path, because the source is downloaded from the VM
				assert.equal(frame.source!.path, undefined);
				assert.equal(frame.source!.name, "dart:core/print.dart");
			}),
			dc.stepIn(),
		);
	});

	it("does not step into the SDK if debugSdkLibraries is false", async () => {
		await openFile(helloWorldMainFile);
		// Get location for `print`
		const printCall = positionOf("pri^nt(");
		const config = await startDebugger(dc, helloWorldMainFile, { debugSdkLibraries: false });
		await dc.hitBreakpoint(config, {
			line: printCall.line + 1,
			path: fsPath(helloWorldMainFile),
		});
		await waitAllThrowIfTerminates(dc,
			dc.assertStoppedLocation("step", {
				// Ensure we stayed in the current file
				path: fsPath(helloWorldMainFile),
			}),
			dc.stepIn(),
		);
	});

	it("steps into an external library if debugExternalLibraries is true", async () => {
		await openFile(helloWorldHttpFile);
		// Get location for `http.read(`
		const httpReadCall = positionOf("http.re^ad(");
		const httpReadDef = await getDefinition(httpReadCall);
		const config = await startDebugger(dc, helloWorldHttpFile, { debugExternalLibraries: true });
		await dc.hitBreakpoint(config, {
			line: httpReadCall.line + 1,
			path: fsPath(helloWorldHttpFile),
		});
		await waitAllThrowIfTerminates(dc,
			dc.assertStoppedLocation("step", {
				// Ensure we stepped into the external file
				path: fsPath(uriFor(httpReadDef)),
			}).then((response) => {
				// Ensure the top stack frame matches
				const frame = response.body.stackFrames[0];
				assert.equal(frame.name, "read");
				assert.equal(frame.source!.path, fsPath(uriFor(httpReadDef)));
				assert.equal(frame.source!.name, "package:http/http.dart");
			}),
			dc.stepIn(),
		);
	});

	it("does not step into an external library if debugExternalLibraries is false", async () => {
		await openFile(helloWorldHttpFile);
		// Get location for `http.read(`
		const httpReadCall = positionOf("http.re^ad(");
		const config = await startDebugger(dc, helloWorldHttpFile, { debugExternalLibraries: false });
		await dc.hitBreakpoint(config, {
			line: httpReadCall.line,
			path: fsPath(helloWorldHttpFile),
		});
		await waitAllThrowIfTerminates(dc,
			dc.assertStoppedLocation("step", {
				// Ensure we stayed in the current file
				path: fsPath(helloWorldHttpFile),
			}),
			dc.stepIn(),
		);
	});

	it("steps into a local library even if debugExternalLibraries is false", async () => {
		await openFile(helloWorldLocalPackageFile);
		// Get location for `printMyThing()`
		const printMyThingCall = positionOf("printMy^Thing(");
		const printMyThingDef = await getDefinition(printMyThingCall);
		const config = await startDebugger(dc, helloWorldLocalPackageFile, { debugExternalLibraries: false });
		await dc.hitBreakpoint(config, {
			line: printMyThingCall.line + 1,
			path: fsPath(helloWorldLocalPackageFile),
		});
		await waitAllThrowIfTerminates(dc,
			dc.assertStoppedLocation("step", {
				// Ensure we stepped into the external file
				path: fsPath(uriFor(printMyThingDef)),
			}).then((response) => {
				// Ensure the top stack frame matches
				const frame = response.body.stackFrames[0];
				assert.equal(frame.name, "printMyThing");
				assert.equal(frame.source!.path, fsPath(uriFor(printMyThingDef)));
				assert.equal(frame.source!.name, "package:my_package/my_thing.dart");
			}),
			dc.stepIn(),
		);
	});

	it("downloads SDK source code from the VM", async function () {
		if (!extApi.dartCapabilities.includesSourceForSdkLibs) {
			this.skip();
			return;
		}

		await openFile(helloWorldMainFile);
		// Get location for `print`
		const printCall = positionOf("pri^nt(");
		const config = await startDebugger(dc, helloWorldMainFile, { debugSdkLibraries: true });
		await dc.hitBreakpoint(config, {
			line: printCall.line + 1,
			path: fsPath(helloWorldMainFile),
		});
		await waitAllThrowIfTerminates(dc,
			dc.assertStoppedLocation("step", {
				// SDK source will have no filename, because we download it
				path: undefined,
			}).then(async (response) => {
				// Ensure the top stack frame matches
				const frame = response.body.stackFrames[0];
				assert.equal(frame.source!.path, undefined);
				assert.equal(frame.source!.name, "dart:core/print.dart");
				const source = await dc.sourceRequest({ source: frame.source, sourceReference: frame.source!.sourceReference! });
				assert.ok(source.body.content);
				assert.ok(
					source.body.content.indexOf("void print(Object object) {") !== -1
					|| source.body.content.indexOf("void print(Object? object) {") !== -1,
				);
				// Ensure comments are present (see #178).
				assert.notEqual(source.body.content.indexOf("\n//"), -1);
			}),
			dc.stepIn(),
		);
	});

	it("correctly marks non-debuggable SDK frames when debugSdkLibraries is false", async () => {
		await openFile(helloWorldThrowInSdkFile);
		const config = await startDebugger(dc, helloWorldThrowInSdkFile, { debugSdkLibraries: false });
		await waitAllThrowIfTerminates(dc,
			dc.configurationSequence(),
			dc.waitForEvent("stopped"),
			dc.launch(config),
		);
		const stack = await dc.getStack();
		ensureFrameCategories(stack.body.stackFrames.filter(isSdkFrame), "deemphasize", "from the Dart SDK");
		ensureFrameCategories(stack.body.stackFrames.filter(isUserCode), undefined, undefined);
	});

	it("correctly marks debuggable SDK frames when debugSdkLibraries is true", async () => {
		await openFile(helloWorldThrowInSdkFile);
		const config = await startDebugger(dc, helloWorldThrowInSdkFile, { debugSdkLibraries: true });
		await waitAllThrowIfTerminates(dc,
			dc.configurationSequence(),
			dc.waitForEvent("stopped"),
			dc.launch(config),
		);
		const stack = await dc.getStack();
		ensureFrameCategories(stack.body.stackFrames.filter(isSdkFrame), undefined, undefined);
		ensureFrameCategories(stack.body.stackFrames.filter(isUserCode), undefined, undefined);
	});

	it("correctly marks non-debuggable external library frames when debugExternalLibraries is false", async () => {
		await openFile(helloWorldThrowInExternalPackageFile);
		const config = await startDebugger(dc, helloWorldThrowInExternalPackageFile, { debugExternalLibraries: false });
		await waitAllThrowIfTerminates(dc,
			dc.configurationSequence(),
			dc.waitForEvent("stopped"),
			dc.launch(config),
		);
		const stack = await dc.getStack();
		ensureFrameCategories(stack.body.stackFrames.filter(isExternalPackage), "deemphasize", "from Pub packages");
		ensureFrameCategories(stack.body.stackFrames.filter(isUserCode), undefined, undefined);
	});

	it("correctly marks debuggable external library frames when debugExternalLibraries is true", async () => {
		await openFile(helloWorldThrowInExternalPackageFile);
		const config = await startDebugger(dc, helloWorldThrowInExternalPackageFile, { debugExternalLibraries: true });
		await waitAllThrowIfTerminates(dc,
			dc.configurationSequence(),
			dc.waitForEvent("stopped"),
			dc.launch(config),
		);
		const stack = await dc.getStack();
		ensureFrameCategories(stack.body.stackFrames.filter(isExternalPackage), undefined, undefined);
		ensureFrameCategories(stack.body.stackFrames.filter(isUserCode), undefined, undefined);
	});

	it("correctly marks debuggable local library frames even when debugExternalLibraries is false", async () => {
		await openFile(helloWorldThrowInLocalPackageFile);
		const config = await startDebugger(dc, helloWorldThrowInLocalPackageFile, { debugExternalLibraries: false });
		await waitAllThrowIfTerminates(dc,
			dc.configurationSequence(),
			dc.waitForEvent("stopped"),
			dc.launch(config),
		);
		const stack = await dc.getStack();
		ensureFrameCategories(stack.body.stackFrames.filter(isLocalPackage), undefined, undefined);
		ensureFrameCategories(stack.body.stackFrames.filter(isUserCode), undefined, undefined);
	});

	it("can fetch slices of stack frames", async () => {
		// TODO: This might be unreliable until dev channel gets this.
		const expectFullCount = !versionIsAtLeast(extApi.dartCapabilities.version, "2.12.0-0");

		await openFile(helloWorldStack60File);
		const config = await startDebugger(dc, helloWorldStack60File);
		await dc.hitBreakpoint(config, {
			line: positionOf("^// BREAKPOINT1").line + 1,
			path: fsPath(helloWorldStack60File),
		});

		// Get the total stack size we should expect and ensure it's a little over the expected 60
		// (don't hard-code the exact value as it may change with SDK releases).
		const fullStack = await dc.getStack(0, 10000);
		const fullStackFrameCount = fullStack.body.totalFrames ?? 0;
		const expectedMin = 60;
		const expectedMax = 80;
		assert.ok(
			fullStackFrameCount >= expectedMin && fullStackFrameCount <= expectedMax,
			`Expected ${expectedMin}-${expectedMax} frames but got ${fullStackFrameCount}:
			${fullStack.body.stackFrames.map((f, i) => `   ${i}: ${f.name}`).join("\n")}`,
		);

		const stack1 = await dc.getStack(0, 1); // frame 0
		const stack2 = await dc.getStack(1, 9); // frame 1-10
		const stack3 = await dc.getStack(10, 10); // frame 10-19
		const stack4 = await dc.getStack(20, 1000); // rest
		assert.strictEqual(stack1.body.stackFrames.length, 1);
		// For the first frame, we'll always get 1 + batchSize because we may short-cut going to the VM.
		assert.strictEqual(stack1.body.totalFrames, 21); // Expect n + 20
		assert.strictEqual(stack2.body.stackFrames.length, 9);
		assert.strictEqual(stack2.body.totalFrames, expectFullCount ? fullStackFrameCount : 30); // offset+length+20
		assert.strictEqual(stack3.body.stackFrames.length, 10);
		assert.strictEqual(stack3.body.totalFrames, expectFullCount ? fullStackFrameCount : 40); // offset+length+20
		assert.strictEqual(stack4.body.stackFrames.length, fullStackFrameCount - 20); // Full minus the 20 already fetched.
		assert.strictEqual(stack4.body.totalFrames, fullStackFrameCount); // Always expect full count for rest
		const frameNames = [
			...stack1.body.stackFrames,
			...stack2.body.stackFrames,
			...stack3.body.stackFrames,
			...stack4.body.stackFrames,
		]
			.map((f) => f.name);
		// The top 60 frames should be from func60 down to func1.
		for (let i = 0; i < 60; i++)
			assert.strictEqual(frameNames[i], `func${60 - i}`);
	});

	function testBreakpointCondition(condition: string, shouldStop: boolean, expectedError?: string) {
		return async () => {
			await openFile(helloWorldMainFile);
			const config = await startDebugger(dc, helloWorldMainFile);

			let didStop = false;

			dc.waitForEvent("stopped")
				.then(() => didStop = true)
				.catch(() => {
					// Swallow errors, as we don't care if this times out, we're only using it
					// to tell if we stopped by the time we hit the end of this test.
				});

			let expectation: Promise<any> = resolvedPromise;
			if (shouldStop)
				expectation = expectation.then(() => dc.waitForEvent("stopped")).then(() => dc.terminateRequest());

			if (expectedError)
				expectation = expectation.then(() => dc.assertOutputContains("console", expectedError));

			await waitAllThrowIfTerminates(dc,
				dc.waitForEvent("terminated"),
				dc.waitForEvent("initialized")
					.then(() => dc.setBreakpointsRequest({
						// positionOf is 0-based, but seems to want 1-based
						breakpoints: [{
							condition,
							line: positionOf("^// BREAKPOINT1").line,
						}],
						source: { path: fsPath(helloWorldMainFile) },
					}))
					.then(() => dc.configurationDoneRequest()),
				expectation,
				dc.launch(config),
			);

			assert.equal(didStop, shouldStop);
		};
	}

	it("stops at a breakpoint with a condition returning true", testBreakpointCondition("1 == 1", true));
	it("stops at a breakpoint with a condition returning 1", testBreakpointCondition("3 - 2", true));
	it("does not stop at a breakpoint with a condition returning a string", testBreakpointCondition("'test'", false));
	it("does not stop at a breakpoint with a condition returning false", testBreakpointCondition("1 == 0", false));
	it("does not stop at a breakpoint with a condition returning 0", testBreakpointCondition("3 - 3", false));
	it("does not stop at a breakpoint with a condition returning null", testBreakpointCondition("print('test');", false));
	it("reports errors evaluating breakpoint conditions", testBreakpointCondition("1 + '1'", false, "Debugger failed to evaluate expression `1 + '1'`"));

	it("logs expected text (and does not stop) at a logpoint", async () => {
		await openFile(helloWorldMainFile);
		const config = await startDebugger(dc, helloWorldMainFile);
		await waitAllThrowIfTerminates(dc,
			dc.waitForEvent("initialized").then((event) => dc.setBreakpointsRequest({
				// positionOf is 0-based, but seems to want 1-based
				breakpoints: [{
					line: positionOf("^// BREAKPOINT1").line + 1,
					// VS Code says to use {} for expressions, but we want to support Dart's native too, so
					// we have examples of both (as well as "escaped" brackets).
					logMessage: '${s} The \\{year} is """{(new DateTime.now()).year}"""',
				}],
				source: { path: fsPath(helloWorldMainFile) },
			})).then((response) => dc.configurationDoneRequest()),
			dc.waitForEvent("terminated"),
			dc.assertOutputContains("stdout", `Hello! The {year} is """${(new Date()).getFullYear()}"""\n`),
			dc.launch(config),
		);
	});

	it("provides local variables when stopped at a breakpoint", async () => {
		await openFile(helloWorldMainFile);
		const debugConfig = await startDebugger(dc, helloWorldMainFile);
		await dc.hitBreakpoint(debugConfig, {
			line: positionOf("^// BREAKPOINT1").line + 1, // positionOf is 0-based, but seems to want 1-based
			path: fsPath(helloWorldMainFile),
		});

		const variables = await dc.getTopFrameVariables("Locals");
		ensureVariable(variables, "l", "l", `List (12 items)`);
		ensureVariable(variables, "longStrings", "longStrings", `List (1 item)`);
		ensureVariable(variables, "tenDates", "tenDates", `List (10 items)`);
		ensureVariable(variables, "hundredDates", "hundredDates", `List (100 items)`);
		ensureVariable(variables, "s", "s", `"Hello!"`);
		ensureVariable(variables, "m", "m", `Map (10 items)`);

		const listVariables = await dc.getVariables(variables.find((v) => v.name === "l")!.variablesReference);
		for (let i = 0; i <= 1; i++) {
			ensureVariableWithIndex(listVariables, i, `l[${i}]`, `[${i}]`, `${i}`);
		}

		const longStringListVariables = await dc.getVariables(variables.find((v) => v.name === "longStrings")!.variablesReference);
		ensureVariable(longStringListVariables, "longStrings[0]", "[0]", {
			ends: "…\"", // String is truncated here.
			starts: "\"This is a long string that is 300 characters!",
		});

		const shortdateListVariables = await dc.getVariables(variables.find((v) => v.name === "tenDates")!.variablesReference);
		ensureVariable(shortdateListVariables, "tenDates[0]", "[0]", "DateTime (2005-01-01 00:00:00.000)");

		const mapVariables = await dc.getVariables(variables.find((v) => v.name === "m")!.variablesReference);
		ensureVariable(mapVariables, undefined, "0", `"l" -> List (12 items)`);
		ensureVariable(mapVariables, undefined, "1", `"longStrings" -> List (1 item)`);
		ensureVariable(mapVariables, undefined, "2", `"tenDates" -> List (10 items)`);
		ensureVariable(mapVariables, undefined, "3", `"hundredDates" -> List (100 items)`);
		ensureVariable(mapVariables, undefined, "4", `"s" -> "Hello!"`);
		ensureVariable(mapVariables, undefined, "5", `DateTime -> "valentines-2000"`);
		ensureVariable(mapVariables, undefined, "6", `DateTime -> "new-year-2005"`);
		ensureVariable(mapVariables, undefined, "7", `true -> true`);
		ensureVariable(mapVariables, undefined, "8", `1 -> "one"`);
		ensureVariable(mapVariables, undefined, "9", `1.1 -> "one-point-one"`);

		await ensureMapEntry(mapVariables, {
			key: { evaluateName: undefined, name: "key", value: `"l"` },
			value: { evaluateName: `m["l"]`, name: "value", value: "List (12 items)" },
		}, dc);
		await ensureMapEntry(mapVariables, {
			key: { evaluateName: undefined, name: "key", value: `"longStrings"` },
			value: { evaluateName: `m["longStrings"]`, name: "value", value: "List (1 item)" },
		}, dc);
		await ensureMapEntry(mapVariables, {
			key: { evaluateName: undefined, name: "key", value: `"s"` },
			value: { evaluateName: `m["s"]`, name: "value", value: `"Hello!"` },
		}, dc);
		await ensureMapEntry(mapVariables, {
			key: { evaluateName: undefined, name: "key", value: `DateTime (2000-02-14 00:00:00.000)` },
			value: { evaluateName: undefined, name: "value", value: `"valentines-2000"` },
		}, dc);
		await ensureMapEntry(mapVariables, {
			key: { evaluateName: undefined, name: "key", value: `DateTime (2005-01-01 00:00:00.000)` },
			value: { evaluateName: undefined, name: "value", value: `"new-year-2005"` },
		}, dc);
		await ensureMapEntry(mapVariables, {
			key: { evaluateName: undefined, name: "key", value: "true" },
			value: { evaluateName: `m[true]`, name: "value", value: "true" },
		}, dc);
		await ensureMapEntry(mapVariables, {
			key: { evaluateName: undefined, name: "key", value: "1" },
			value: { evaluateName: `m[1]`, name: "value", value: `"one"` },
		}, dc);
		await ensureMapEntry(mapVariables, {
			key: { evaluateName: undefined, name: "key", value: "1.1" },
			value: { evaluateName: `m[1.1]`, name: "value", value: `"one-point-one"` },
		}, dc);
	});

	it("excludes type args from local variables when stopped at a breakpoint in a generic method", async () => {
		await openFile(helloWorldMainFile);
		const debugConfig = await startDebugger(dc, helloWorldMainFile);
		await dc.hitBreakpoint(debugConfig, {
			line: positionOf("^// BREAKPOINT2").line + 1, // positionOf is 0-based, but seems to want 1-based
			path: fsPath(helloWorldMainFile),
		});

		const variables = await dc.getTopFrameVariables("Locals");
		ensureVariable(variables, "a", "a", `1`);
		// Ensure there were no others.
		assert.equal(variables.length, 1);
	});

	it("includes fields and getters in variables when stopped at a breakpoint", async () => {
		await openFile(helloWorldGettersFile);
		const config = await startDebugger(dc, helloWorldGettersFile);
		await dc.hitBreakpoint(config, {
			line: positionOf("^// BREAKPOINT1").line + 1, // positionOf is 0-based, but seems to want 1-based
			path: fsPath(helloWorldGettersFile),
		});

		const variables = await dc.getTopFrameVariables("Locals");
		ensureVariable(variables, "danny", "danny", `Danny`);

		const classInstance = await dc.getVariables(variables.find((v) => v.name === "danny")!.variablesReference);
		// Fields
		ensureVariable(classInstance, "danny.field", "field", `"field"`);
		ensureVariable(classInstance, "danny.baseField", "baseField", `"baseField"`);
		// Getters
		ensureVariable(classInstance, "danny.kind", "kind", `"Person"`);
		ensureVariable(classInstance, "danny.name", "name", `"Danny"`);
		ensureVariable(classInstance, undefined, "throws", { starts: "Unhandled exception:\nOops!" });
	});

	it("includes fields but not getters in variables when evaluateGettersInDebugViews=false", async () => {
		await setConfigForTest("dart", "evaluateGettersInDebugViews", false);

		await openFile(helloWorldGettersFile);
		const config = await startDebugger(dc, helloWorldGettersFile);
		await dc.hitBreakpoint(config, {
			line: positionOf("^// BREAKPOINT1").line + 1, // positionOf is 0-based, but seems to want 1-based
			path: fsPath(helloWorldGettersFile),
		});

		const variables = await dc.getTopFrameVariables("Locals");
		ensureVariable(variables, "danny", "danny", `Danny`);

		const classInstance = await dc.getVariables(variables.find((v) => v.name === "danny")!.variablesReference);
		// Fields
		ensureVariable(classInstance, "danny.field", "field", `"field"`);
		ensureVariable(classInstance, "danny.baseField", "baseField", `"baseField"`);
		// No getters
		ensureNoVariable(classInstance, "kind");
		ensureNoVariable(classInstance, "name");
		ensureNoVariable(classInstance, "throws");
	});

	it("watch expressions provide same info as locals", async () => {
		await openFile(helloWorldMainFile);
		const config = await startDebugger(dc, helloWorldMainFile);
		await dc.hitBreakpoint(config, {
			line: positionOf("^// BREAKPOINT1").line + 1, // positionOf is 0-based, but seems to want 1-based
			path: fsPath(helloWorldMainFile),
		});

		const variables = await dc.getTopFrameVariables("Locals");

		for (const variable of variables) {
			const evaluateName = (variable as any).evaluateName;
			if (!evaluateName)
				continue;
			const evaluateResult = await dc.evaluateForFrame(evaluateName);
			assert.ok(evaluateResult);
			assert.equal(evaluateResult.result, variable.value);
			assert.equal(!!evaluateResult.variablesReference, !!variable.variablesReference);
		}
	});

	it("evaluateName evaluates to the expected value", async () => {
		await openFile(helloWorldMainFile);
		const config = await startDebugger(dc, helloWorldMainFile);
		await dc.hitBreakpoint(config, {
			line: positionOf("^// BREAKPOINT1").line + 1, // positionOf is 0-based, but seems to want 1-based
			path: fsPath(helloWorldMainFile),
		});

		const variables = await dc.getTopFrameVariables("Locals");
		const listVariables = await dc.getVariables(variables.find((v) => v.name === "l")!.variablesReference);
		const listLongstringVariables = await dc.getVariables(variables.find((v) => v.name === "longStrings")!.variablesReference);
		const mapVariables = await dc.getVariables(variables.find((v) => v.name === "m")!.variablesReference);
		const allVariables = listVariables.concat(listLongstringVariables).concat(mapVariables);

		for (const variable of allVariables) {
			const evaluateName = (variable as any).evaluateName;
			if (!evaluateName)
				continue;
			const evaluateResult = await dc.evaluateForFrame(evaluateName);
			assert.ok(evaluateResult);
			if (variable.value.endsWith("…\"")) {
				// If the value was truncated, the evaluate responses should be longer
				const prefix = variable.value.slice(1, -2);
				assert.ok(evaluateResult.result.length > prefix.length);
				assert.equal(evaluateResult.result.slice(0, prefix.length), prefix);
			} else {
				// Otherwise it should be the same.
				assert.equal(evaluateResult.result, variable.value);
			}
			assert.equal(!!evaluateResult.variablesReference, !!variable.variablesReference);
		}
	});

	describe("can evaluate at breakpoint", () => {
		it("simple expressions", async () => {
			await openFile(helloWorldMainFile);
			const config = await startDebugger(dc, helloWorldMainFile);
			await waitAllThrowIfTerminates(dc,
				dc.hitBreakpoint(config, {
					line: positionOf("^// BREAKPOINT1").line, // positionOf is 0-based, and seems to want 1-based, BUT comment is on next line!
					path: fsPath(helloWorldMainFile),
				}),
			);

			const evaluateResult = await dc.evaluateForFrame(`"test"`);
			assert.ok(evaluateResult);
			assert.equal(evaluateResult.result, `"test"`);
			assert.equal(evaluateResult.variablesReference, 0);
		});

		it("complex expression expressions", async () => {
			await openFile(helloWorldMainFile);
			const config = await startDebugger(dc, helloWorldMainFile);
			await waitAllThrowIfTerminates(dc,
				dc.hitBreakpoint(config, {
					line: positionOf("^// BREAKPOINT1").line, // positionOf is 0-based, and seems to want 1-based, BUT comment is on next line!
					path: fsPath(helloWorldMainFile),
				}),
			);

			const evaluateResult = await dc.evaluateForFrame(`(new DateTime.now()).year`);
			assert.ok(evaluateResult);
			assert.equal(evaluateResult.result, (new Date()).getFullYear());
			assert.equal(evaluateResult.variablesReference, 0);
		});

		it("an expression that returns a variable", async () => {
			await openFile(helloWorldMainFile);
			const config = await startDebugger(dc, helloWorldMainFile);
			await waitAllThrowIfTerminates(dc,
				dc.hitBreakpoint(config, {
					line: positionOf("^// BREAKPOINT1").line, // positionOf is 0-based, and seems to want 1-based, BUT comment is on next line!
					path: fsPath(helloWorldMainFile),
				}),
			);

			const evaluateResult = await dc.evaluateForFrame(`new DateTime.now()`);
			const thisYear = new Date().getFullYear().toString();
			assert.ok(evaluateResult);
			assert.ok(evaluateResult.result.startsWith("DateTime (" + thisYear), `Result '${evaluateResult.result}' did not start with ${thisYear}`);
			assert.ok(evaluateResult.variablesReference);
		});

		it("complex expression expressions when in a top level function", async () => {
			await openFile(helloWorldMainFile);
			const config = await startDebugger(dc, helloWorldMainFile);
			await waitAllThrowIfTerminates(dc,
				dc.hitBreakpoint(config, {
					line: positionOf("^// BREAKPOINT2").line, // positionOf is 0-based, and seems to want 1-based, BUT comment is on next line!
					path: fsPath(helloWorldMainFile),
				}),
			);

			const evaluateResult = await dc.evaluateForFrame(`(new DateTime.now()).year`);
			assert.ok(evaluateResult);
			assert.equal(evaluateResult.result, (new Date()).getFullYear());
			assert.equal(evaluateResult.variablesReference, 0);
		});

		it("can evaluate expressions with trailing semicolons", async () => {
			await openFile(helloWorldMainFile);
			const config = await startDebugger(dc, helloWorldMainFile);
			await waitAllThrowIfTerminates(dc,
				dc.hitBreakpoint(config, {
					line: positionOf("^// BREAKPOINT2").line, // positionOf is 0-based, and seems to want 1-based, BUT comment is on next line!
					path: fsPath(helloWorldMainFile),
				}),
			);

			const evaluateResult = await dc.evaluateForFrame(`(new DateTime.now()).year;`);
			assert.ok(evaluateResult);
			assert.equal(evaluateResult.result, (new Date()).getFullYear());
			assert.equal(evaluateResult.variablesReference, 0);
		});

		it("returns a full error message for repl context", async () => {
			await openFile(helloWorldMainFile);
			const config = await startDebugger(dc, helloWorldMainFile);
			await waitAllThrowIfTerminates(dc,
				dc.hitBreakpoint(config, {
					line: positionOf("^// BREAKPOINT2").line, // positionOf is 0-based, and seems to want 1-based, BUT comment is on next line!
					path: fsPath(helloWorldMainFile),
				}),
			);

			const error = await dc.evaluateForFrame("DateTime.now().ye", "repl").catch((e) => e);
			assert.notEqual(error.message.indexOf("The getter 'ye' isn't defined for the class 'DateTime'"), -1);
		});

		it("returns a short error message for watch context", async () => {
			await openFile(helloWorldMainFile);
			const config = await startDebugger(dc, helloWorldMainFile);
			await waitAllThrowIfTerminates(dc,
				dc.hitBreakpoint(config, {
					line: positionOf("^// BREAKPOINT2").line, // positionOf is 0-based, and seems to want 1-based, BUT comment is on next line!
					path: fsPath(helloWorldMainFile),
				}),
			);

			const error = await dc.evaluateForFrame("DateTime.now().ye", "watch").catch((e) => e);
			assert.equal(error.message, "not available");
		});
	});

	describe("can evaluate when not at a breakpoint", () => {
		it("simple expressions", async () => {
			await openFile(helloWorldLongRunningFile);
			const config = await startDebugger(dc, helloWorldLongRunningFile);
			await waitAllThrowIfTerminates(dc,
				dc.configurationSequence(),
				dc.launch(config),
			);

			await dc.tryWaitUntilGlobalEvaluationIsAvailable();

			const evaluateResult = await dc.evaluateRequest({ expression: `"test"` });
			assert.ok(evaluateResult);
			assert.ok(evaluateResult.body);
			assert.equal(evaluateResult.body.result, `"test"`);
			assert.equal(evaluateResult.body.variablesReference, 0);
		});

		it("complex expression expressions", async () => {
			await openFile(helloWorldLongRunningFile);
			const config = await startDebugger(dc, helloWorldLongRunningFile);
			await waitAllThrowIfTerminates(dc,
				dc.configurationSequence(),
				dc.launch(config),
			);

			await dc.tryWaitUntilGlobalEvaluationIsAvailable();

			const evaluateResult = await dc.evaluateRequest({ expression: `(new DateTime.now()).year` });
			assert.ok(evaluateResult);
			assert.ok(evaluateResult.body);
			assert.equal(evaluateResult.body.result, (new Date()).getFullYear());
			assert.equal(evaluateResult.body.variablesReference, 0);
		});

		it("an expression that returns a variable", async () => {
			await openFile(helloWorldLongRunningFile);
			const config = await startDebugger(dc, helloWorldLongRunningFile);
			await waitAllThrowIfTerminates(dc,
				dc.configurationSequence(),
				dc.launch(config),
			);

			await dc.tryWaitUntilGlobalEvaluationIsAvailable();

			const evaluateResult = await dc.evaluateRequest({ expression: `new DateTime.now()` });
			const thisYear = new Date().getFullYear().toString();
			assert.ok(evaluateResult);
			assert.ok(evaluateResult.body);
			assert.ok(evaluateResult.body.result.startsWith("DateTime (" + thisYear), `Result '${evaluateResult.body.result}' did not start with ${thisYear}`);
			assert.ok(evaluateResult.body.variablesReference);
		});

		it("can evaluate expressions with trailing semicolons", async () => {
			await openFile(helloWorldLongRunningFile);
			const config = await startDebugger(dc, helloWorldLongRunningFile);
			await waitAllThrowIfTerminates(dc,
				dc.configurationSequence(),
				dc.launch(config),
			);

			await dc.tryWaitUntilGlobalEvaluationIsAvailable();

			const evaluateResult = await dc.evaluateRequest({ expression: `(new DateTime.now()).year;` });
			assert.ok(evaluateResult);
			assert.ok(evaluateResult.body);
			assert.equal(evaluateResult.body.result, (new Date()).getFullYear());
			assert.equal(evaluateResult.body.variablesReference, 0);
		});

		it("returns a full error message for repl context", async () => {
			await openFile(helloWorldLongRunningFile);
			const config = await startDebugger(dc, helloWorldLongRunningFile);
			await waitAllThrowIfTerminates(dc,
				dc.configurationSequence(),
				dc.launch(config),
			);

			await dc.tryWaitUntilGlobalEvaluationIsAvailable();

			const error = await dc.evaluateRequest({ expression: "DateTime.now().ye", context: "repl" }).catch((e) => e);
			assert.notEqual(error.message.indexOf("The getter 'ye' isn't defined for the class 'DateTime'"), -1);
		});

		it("returns a short error message for watch context", async () => {
			await openFile(helloWorldLongRunningFile);
			const config = await startDebugger(dc, helloWorldLongRunningFile);
			await waitAllThrowIfTerminates(dc,
				dc.configurationSequence(),
				dc.launch(config),
			);

			await dc.tryWaitUntilGlobalEvaluationIsAvailable();

			const error = await dc.evaluateRequest({ expression: "DateTime.now().ye", context: "watch" }).catch((e) => e);
			assert.equal(error.message, "not available");
		});
	});

	it("prints the output of inspected variables", async () => {
		await openFile(helloWorldInspectFile);
		const debugConfig = await startDebugger(dc, helloWorldInspectFile);
		const expectedVariablesTree = `
insp=<inspected variable>
  [0]=Person
    name="Danny"
  [1]=Person
    name="Fred"
		`.trim();

		await waitAllThrowIfTerminates(dc,
			dc.waitForCustomEvent<{ variablesReference?: number }>("output", (e) => !!e?.variablesReference)
				.then(async (output) => {
					const variablesTree = await getVariablesTree(dc, output.variablesReference!);
					assert.equal(variablesTree.join("\n"), expectedVariablesTree);
				})
				.then(() => dc.terminateRequest()),
			dc.configurationSequence(),
			dc.waitForEvent("terminated"),
			dc.launch(debugConfig),
		);
	});

	it("stops on exception", async () => {
		await openFile(helloWorldBrokenFile);
		const config = await startDebugger(dc, helloWorldBrokenFile);
		await waitAllThrowIfTerminates(dc,
			dc.configurationSequence(),
			dc.assertStoppedLocation("exception", {
				line: positionOf("^throw").line + 1, // positionOf is 0-based, but seems to want 1-based
				path: fsPath(helloWorldBrokenFile),
			}),
			dc.launch(config),
		);
	});

	it("does not stop on exception in noDebug mode", async () => {
		await openFile(helloWorldBrokenFile);
		const config = await startDebugger(dc, helloWorldBrokenFile);
		config.noDebug = true;
		await waitAllThrowIfTerminates(dc,
			dc.configurationSequence(),
			dc.waitForEvent("terminated"),
			dc.launch(config),
		);
	});

	it("provides exception details when stopped on exception", async () => {
		await openFile(helloWorldBrokenFile);
		const config = await startDebugger(dc, helloWorldBrokenFile);
		await waitAllThrowIfTerminates(dc,
			dc.configurationSequence(),
			dc.assertStoppedLocation("exception", {
				line: positionOf("^throw").line + 1, // TODO: This line seems to be one-based but position is zero-based?
				path: fsPath(helloWorldBrokenFile),
			}),
			dc.launch(config),
		);

		const variables = await dc.getTopFrameVariables("Exception");
		ensureVariable(variables, "$e.message", "message", `"Oops"`);
	});

	it("writes exception to stderr", async () => {
		await openFile(helloWorldBrokenFile);
		const config = await startDebugger(dc, helloWorldBrokenFile);
		config.noDebug = true;
		await waitAllThrowIfTerminates(dc,
			dc.configurationSequence(),
			dc.assertOutput("stderr", "Unhandled exception:"),
			dc.waitForEvent("terminated"),
			dc.launch(config),
		);
	});

	it("moves known files from call stacks to metadata", async () => {
		await openFile(helloWorldBrokenFile);
		const config = await startDebugger(dc, helloWorldBrokenFile);
		config.noDebug = true;
		await waitAllThrowIfTerminates(dc,
			dc.configurationSequence(),
			watchPromise(
				"writes_failure_output->assertOutputContains",
				dc.assertOutputContains("stderr", "#0      main")
					.then((event) => {
						assert.equal(event.body.output.indexOf("broken.dart"), -1);
						assert.equal(event.body.source!.name, path.join("bin", "broken.dart"));
						assert.equal(event.body.source!.path, fsPath(helloWorldBrokenFile));
						assert.equal(event.body.line, positionOf("^Oops").line + 1); // positionOf is 0-based, but seems to want 1-based
						assert.equal(event.body.column, 3);
					}),
			),
			watchPromise("writes_failure_output->launch", dc.launch(config)),
		);
	});

	describe("attaches", () => {
		it("to a paused Dart script and can unpause to run it to completion", async () => {
			const process = spawnDartProcessPaused(helloWorldMainFile, helloWorldFolder);
			const observatoryUri = await process.vmServiceUri;

			const config = await attachDebugger(observatoryUri);
			await waitAllThrowIfTerminates(dc,
				dc.configurationSequence(),
				dc.waitForEvent("terminated"),
				dc.launch(config),
			);
		});

		it("to a paused Dart script and can collects stdout", async () => {
			const process = spawnDartProcessPaused(helloWorldMainFile, helloWorldFolder);
			const observatoryUri = await process.vmServiceUri;

			const config = await attachDebugger(observatoryUri);
			await waitAllThrowIfTerminates(dc,
				dc.configurationSequence(),
				dc.assertOutputContains("stdout", "Hello, world!"),
				dc.waitForEvent("terminated"),
				dc.launch(config),
			);
		});

		it("to a Dart script launched externally using --write-service-info and can unpause to run it to completion", async () => {
			const tempVmServiceInfoFile = path.join(os.tmpdir(), `dart-vm-service-${getRandomInt(0x1000, 0x10000).toString(16)}.json`);
			const vmArgs = [
				`--write-service-info=${vs.Uri.file(tempVmServiceInfoFile)}`,
			];
			const process = spawnDartProcessPaused(helloWorldMainFile, helloWorldFolder, ...vmArgs);

			const config = await attachDebugger(undefined, { serviceInfoFile: tempVmServiceInfoFile });
			await waitAllThrowIfTerminates(dc,
				dc.configurationSequence(),
				dc.waitForEvent("terminated"),
				dc.launch(config),
			);
		});

		it("when provided only a port in launch.config", async () => {
			const vmArgs = ["--disable-service-auth-codes"];
			const process = spawnDartProcessPaused(helloWorldMainFile, helloWorldFolder, ...vmArgs);
			const observatoryUri = await process.vmServiceUri;
			const observatoryPort = /:([0-9]+)\//.exec(observatoryUri)![1];

			// Include whitespace as a test for trimming.
			const config = await attachDebugger(` ${observatoryPort} `);
			await waitAllThrowIfTerminates(dc,
				dc.configurationSequence(),
				dc.waitForEvent("terminated"),
				dc.launch(config),
			);
		});

		it("to the observatory uri provided by the user when not specified in launch.json", async () => {
			const process = spawnDartProcessPaused(helloWorldMainFile, helloWorldFolder);
			const observatoryUri = await process.vmServiceUri;

			const showInputBox = sb.stub(vs.window, "showInputBox");
			showInputBox.resolves(observatoryUri);

			const config = await attachDebugger(undefined);
			await waitAllThrowIfTerminates(dc,
				dc.configurationSequence(),
				dc.waitForEvent("terminated"),
				dc.launch(config),
			);

			assert.ok(showInputBox.calledOnce);
		});

		it("to a paused Dart script and can set breakpoints", async () => {
			const process = spawnDartProcessPaused(helloWorldMainFile, helloWorldFolder);
			const observatoryUri = await process.vmServiceUri;

			const config = await attachDebugger(observatoryUri);
			await dc.hitBreakpoint(config, {
				line: positionOf("^// BREAKPOINT1").line + 1, // positionOf is 0-based, but seems to want 1-based
				path: fsPath(helloWorldMainFile),
			});
		});

		it("and removes breakpoints and unpauses on detach", async () => {
			const process = spawnDartProcessPaused(helloWorldMainFile, helloWorldFolder);
			const observatoryUri = await process.vmServiceUri;

			const config = await attachDebugger(observatoryUri);
			await dc.hitBreakpoint(config, {
				line: positionOf("^// BREAKPOINT1").line + 1, // positionOf is 0-based, but seems to want 1-based
				path: fsPath(helloWorldMainFile),
			});
			await dc.terminateRequest();

			await process.exitCode;
		});

		it("and reports failure to connect to the Observatory");
	});
});
