'use strict';

import { ExtensionContext, workspace, window, Disposable, commands, Uri, WorkspaceConfiguration, OutputChannel } from 'vscode';
import { ClearCaseSCMProvider } from './ccScmProvider';
import { Model } from './model';
import * as nls from 'vscode-nls';
import * as path from 'path';
import * as cp from 'child_process';

const localize: nls.LocalizeFunc = nls.loadMessageBundle();

async function init(context: ExtensionContext, disposables: Disposable[]): Promise<void> {
    const { name, version, aiKey } = require(context.asAbsolutePath('./package.json')) as { name: string, version: string, aiKey: string };

    const config: WorkspaceConfiguration = workspace.getConfiguration('clearcase');
    const enabled: boolean = config.get<boolean>('enabled') === true;
    const workspaceRootPath: string | undefined = workspace.rootPath;

    if (!workspaceRootPath || !enabled) {
        return;
    }

    const outputChannel: OutputChannel = window.createOutputChannel('ClearCase SCM');
    disposables.push(outputChannel);

    if (enabled) {
        const info: string = await getClearCaseInfo();
        outputChannel.appendLine(info);
        outputChannel.show(true);
    }

    const provider: ClearCaseSCMProvider = new ClearCaseSCMProvider(outputChannel, workspaceRootPath);

     disposables.push(
        provider
    );
}

export function activate(context: ExtensionContext): void {

    const disposables: Disposable[] = [];
    context.subscriptions.push(new Disposable(() => Disposable.from(...disposables).dispose()));

    init(context, disposables)
        .catch(err => console.error(err));
}

export function deactivate(): void {
    return;
}

async function getClearCaseInfo(): Promise<string> {
    return new Promise<string>(
        // tslint:disable-next-line:typedef
        function(resolve, reject): void {
        cp.exec('cleartool -verAll', (err : Error, output : string) => {
            if (err) {
                reject(localize('no ClearCase', 'ClearCase not found!'));
            }
            resolve(output);
        });
    });
}