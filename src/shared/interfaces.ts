import * as child_process from "child_process";
import * as stream from "stream";
import { DaemonCapabilities } from "./capabilities/flutter";
import { LogCategory, LogSeverity } from "./enums";
import * as f from "./flutter/daemon_interfaces";
import { UnknownResponse } from "./services/interfaces";
import { WorkspaceContext } from "./workspace";

export interface SdkSearchResults {
	sdkPath: string | undefined;
	candidatePaths: string[];
}

export interface Sdks {
	readonly dart?: string;
	readonly dartVersion?: string;
	readonly flutter?: string;
	readonly flutterVersion?: string;
	readonly dartSdkIsFromFlutter: boolean;
}

export interface DartSdks extends Sdks {
	readonly dart: string;
}

export interface FlutterSdks extends Sdks {
	readonly flutter: string;
}

export interface DartWorkspaceContext extends WorkspaceContext {
	readonly sdks: DartSdks;
}

// TODO(dantup): Move capabilities onto here?
export interface FlutterWorkspaceContext extends WorkspaceContext {
	readonly sdks: FlutterSdks;
}

export interface WritableWorkspaceConfig {
	// All fields here should handle undefined, and the default (undefined) state
	// should be what is expected from a standard workspace without any additional
	// config.

	startDevToolsServerEagerly?: boolean;
	disableAutomaticPackageGet?: boolean;
	disableSdkUpdateChecks?: boolean;
	flutterDaemonScript?: CustomScript;
	flutterDoctorScript?: CustomScript;
	flutterRunScript?: CustomScript;
	flutterScript?: CustomScript;
	flutterSdkHome?: string;
	flutterTestScript?: CustomScript;
	flutterVersion?: string;
	useLsp?: boolean;
	useVmForTests?: boolean;
	forceFlutterWorkspace?: boolean;
	forceFlutterDebug?: boolean;
	skipFlutterInitialization?: boolean;
	skipTargetFlag?: boolean;
}

export type WorkspaceConfig = Readonly<WritableWorkspaceConfig>;
export interface CustomScript {
	script: string;
	replacesArgs: number;
}

export interface DartProjectTemplate {
	readonly name: string;
	readonly label: string;
	readonly description: string;
	readonly categories: string[];
	readonly entrypoint: string;
}

export interface FlutterCreateTriggerData {
	readonly sample?: string;
	readonly template?: string;
}

export interface Logger {
	info(message: string, category?: LogCategory): void;
	warn(message: SomeError, category?: LogCategory): void;
	error(error: SomeError, category?: LogCategory): void;
}

export type SomeError = string | Error | undefined | { message: string };

export interface LogMessage {
	readonly message: string;
	readonly severity: LogSeverity;
	readonly category: LogCategory;
	toLine(maxLength: number): string;
}

export interface IAmDisposable {
	dispose(): void | Promise<void>;
}

export interface IFlutterDaemon extends IAmDisposable {
	capabilities: DaemonCapabilities;

	deviceEnable(): Thenable<UnknownResponse>;
	getEmulators(): Thenable<f.FlutterEmulator[]>;
	launchEmulator(emulatorId: string, coldBoot: boolean): Thenable<void>;
	createEmulator(name?: string): Thenable<{ success: boolean, emulatorName: string, error: string }>;
	getSupportedPlatforms(projectRoot: string): Thenable<f.SupportedPlatformsResponse>;

	registerForDaemonConnected(subscriber: (notification: f.DaemonConnected) => void): IAmDisposable;
	registerForDeviceAdded(subscriber: (notification: f.Device) => void): IAmDisposable;
	registerForDeviceRemoved(subscriber: (notification: f.Device) => void): IAmDisposable;
	registerForDaemonLogMessage(subscriber: (notification: f.DaemonLogMessage) => void): IAmDisposable;
	registerForDaemonLog(subscriber: (notification: f.DaemonLog) => void): IAmDisposable;
	registerForDaemonShowMessage(subscriber: (notification: f.ShowMessage) => void): IAmDisposable;
}

export type Emulator = (f.FlutterEmulator & { type: "emulator" }) | CustomEmulator;

export interface CustomEmulator {
	id: string;
	type: "custom-emulator";
	category: "custom" | f.Category;
	platformType?: undefined | f.PlatformType;
	name: string;
	executable: string;
	args?: string[];
	env: any;
}

export interface EmulatorCreator {
	id?: undefined;
	type: "emulator-creator";
	platformType: "android";
}

export interface PlatformEnabler {
	id?: undefined;
	type: "platform-enabler";
	platformType: f.PlatformType;
}

export interface FlutterCreateCommandArgs {
	projectPath?: string;
	projectName?: string;
	triggerData?: FlutterCreateTriggerData;
	platform?: string;
}

export interface CustomEmulatorDefinition {
	id: string;
	name: string;
	executable: string;
	args?: string[];
}

export interface Location {
	startLine: number;
	startColumn: number;
	length: number;
}

export interface FlutterRawSurveyData {
	uniqueId: string;
	title: string;
	url: string;
	startDate: string;
	endDate: string;
}

export interface FlutterSurveyData {
	uniqueId: string;
	title: string;
	url: string;
	startDate: number;
	endDate: number;
}

export type SpawnedProcess = child_process.ChildProcess & {
	stdin: stream.Writable,
	stdout: stream.Readable,
	stderr: stream.Readable,
};

export interface OpenedFileInformation {
	readonly contents: string;
	readonly selectionOffset: number;
	readonly selectionLength: number;
}

export interface DevToolsPage {
	id: string;
	commandId: string;
	routeId?: (flutterVersion: string | undefined) => string;
	title: string;
}

export interface WidgetErrorInspectData {
	errorDescription: string;
	devToolsUrl: string;
	inspectorReference: string;
}
