'use strict';

import { scm, Uri, Disposable, SourceControl, SourceControlResourceGroup, SourceControlResourceState, SourceControlResourceDecorations,
  Event, workspace, commands, OutputChannel, Command, window } from 'vscode';
import { ClearCase } from './clearcase';
import { Model } from './model';
import * as path from 'path';
import * as nls from 'vscode-nls';
import * as cp from 'child_process';
import * as fs from 'fs';

const localize: nls.LocalizeFunc = nls.loadMessageBundle();

function createResourceUri(relativePath: string): Uri {
  if (!workspace.rootPath) {
    return new Uri();
  }
  const absolutePath: string = path.join(workspace.rootPath, relativePath);
  return Uri.file(absolutePath);
}


interface VcCommand {
  commandId: string;
  key: string;
  method: Function;
  skipModelCheck: boolean;
  requiresDiffInformation: boolean;
}

const VCCommands: VcCommand[] = [];

function command(commandId: string, skipModelCheck: boolean = false, requiresDiffInformation: boolean = false): Function {
  return (target: any, key: string, descriptor: any) => {
    if (!(typeof descriptor.value === 'function')) {
      throw new Error('not supported');
    }

    VCCommands.push({ commandId, key, method: descriptor.value, skipModelCheck, requiresDiffInformation });
  };
}

export class CCElementSourceControlResourceState implements SourceControlResourceState {
  readonly resourceUri: Uri;
  readonly command?: Command;
  readonly decorations?: SourceControlResourceDecorations;

  constructor(uri : Uri, private extendedVersion : string) {
    this.resourceUri = uri;
  }

  get extVersion(): string { return this.extendedVersion; }
}

export class ClearCaseSCMProvider {

  private disposables: Disposable[] = [];
  get contextKey(): string { return 'clearcase'; }

  get label(): string { return 'ClearCase'; }

  get count(): number {
    if (!this.checkedOutsResourceStates) {
      return 0;
    }
    return this.checkedOutsResourceStates.length;
  }

  private _sourceControl: SourceControl;

  get sourceControl(): SourceControl {
    return this._sourceControl;
  }

  private checkedOutsGroup: SourceControlResourceGroup;
  private checkedOutsResourceStates : SourceControlResourceState[];
  private elementsGroup: SourceControlResourceGroup;
  private elementsResourceStates : SourceControlResourceState[];
  private viewPrivatesGroup: SourceControlResourceGroup;
  private viewPrivatesResourceStates : SourceControlResourceState[];

  private _clearCase : ClearCase;
  private _model : Model;

  constructor(
    private outputChannel : OutputChannel,
    private workspaceRootPath : string
  ) {
    this._sourceControl = scm.createSourceControl('clearcase', 'ClearCase');

    this.disposables = VCCommands
      .map(({ commandId, key, method }) => {
        const command: (...args: any[]) => any = this.createCommand(commandId, key, method);
        return commands.registerCommand(commandId, command);
      });
    this.disposables.push(this._sourceControl);

    this._sourceControl.acceptInputCommand = { command: 'clearcase.checkin', title: localize('checkin', 'Checkin') };

    this._model = new Model(workspaceRootPath);
    this._model.onWorkspaceChange(this.onFsChanged, this, this.disposables);
    this.disposables.push(this._model);

    this.checkedOutsGroup = this._sourceControl.createResourceGroup('checkedouts', 'Checked Out Elements');
    this.checkedOutsResourceStates = [];
    this.elementsGroup = this._sourceControl.createResourceGroup('elems', 'Elements');
    this.elementsResourceStates = [];
    this.viewPrivatesGroup = this._sourceControl.createResourceGroup('viewprivates', 'View Private Files');
    this.viewPrivatesResourceStates = [];

    this.elementsGroup.hideWhenEmpty = true;
    this.checkedOutsGroup.hideWhenEmpty = true;
    this.viewPrivatesGroup.hideWhenEmpty = true;

    this.disposables.push(this.checkedOutsGroup);
    this.disposables.push(this.elementsGroup);
    this.disposables.push(this.viewPrivatesGroup);

    this._clearCase = new ClearCase(outputChannel, workspaceRootPath);

    this.updateResourceGroups();
  }

  private async updateCheckedOutsGroup(): Promise<void> {
    this.checkedOutsResourceStates = [];
    let relPathToResourceState:(e: string) => SourceControlResourceState = (e: string) => {
      return { resourceUri: createResourceUri(e) };
    };
    await this._clearCase.listCheckedOuts((data) => {
      data.
      map(relPathToResourceState).
      forEach(state => this.checkedOutsResourceStates.push(state));
      this.checkedOutsGroup.resourceStates = this.checkedOutsResourceStates;
    });
    await this.updateCountOnBadge();
  }

  private async updateElementsGroup(): Promise<void> {
    this.elementsResourceStates = [];
    let extendedPathToCCResourceState:(e: string) => SourceControlResourceState = (e: string) => {
      let a: string[] = e.split(/@@/);
      return new CCElementSourceControlResourceState(Uri.file(path.join(this.workspaceRootPath, a[0])), a[1]);
    };
    await this._clearCase.listElements((data) => {
      data.
      map(extendedPathToCCResourceState).
      forEach(state => this.elementsResourceStates.push(state));
      this.elementsGroup.resourceStates = this.elementsResourceStates;
    });
    await this.updateCountOnBadge();
  }

  private async updateViewPrivatesGroup(): Promise<void> {
    this.viewPrivatesResourceStates = [];
    let thisArg: ClearCaseSCMProvider = this;
    let relPathToResourceState:(e: string) => SourceControlResourceState = (e: string) => {
      return { resourceUri: createResourceUri(path.join(this.workspaceRootPath, e)) };
    };
    await this._clearCase.listViewPrivates((data) => {
      data.
      map(relPathToResourceState).
      forEach(state => this.viewPrivatesResourceStates.push(state));
      this.viewPrivatesGroup.resourceStates = this.viewPrivatesResourceStates;
    });
    await this.updateCountOnBadge();
  }

  private async updateCountOnBadge(): Promise<void> {
    this._sourceControl.count = this.count;
  }

  private async updateResourceGroups(): Promise<void> {
    await this.updateCheckedOutsGroup();
    await this.updateElementsGroup();
    await this.updateViewPrivatesGroup();
  }

  private onFsChanged(uri: Uri): void {
    this.updateResourceGroups();
  }

  private argsToString(...resourceStates: SourceControlResourceState[]): string | null {
    if (!resourceStates || resourceStates.length === 0) {
      let editor = window.activeTextEditor
      if (!editor) {
        return null;
      }
      return `"${editor.document.fileName}"`;
    }
    if (resourceStates.length === 1) {
      return `"${resourceStates[0].resourceUri.fsPath}"`;
    }
    return resourceStates.
      map(rs => rs.resourceUri.fsPath).
      reduce(function(acc: string, val: string): string {
        return acc + ' ' + `"${val}"`;
      });
  }

  @command('clearcase.lsvtree')
  async showVersionTree(...resourceStates: SourceControlResourceState[]): Promise<void> {
    let param: string | null = this.argsToString.apply(this, resourceStates);
    if (!param) {
      return;
    }
    return await this._clearCase.showVersionTree(param);
  }

  @command('clearcase.checkin')
  async checkin(...resourceStates: SourceControlResourceState[]): Promise<void> {
    let param: string | null = this.argsToString.apply(this, resourceStates);
    if (!param) {
      return;
    }
    await this._clearCase.checkIn(param, scm.inputBox.value);
    await this.updateResourceGroups();
  }

  @command('clearcase.checkout')
  async checkout(...resourceStates: SourceControlResourceState[]): Promise<void> {
    let param: string | null = this.argsToString.apply(this, resourceStates);
    if (!param) {
      return;
    }
    await this._clearCase.checkOut(param);
    await this.updateResourceGroups();
  }

  @command('clearcase.undocheckout')
  async undocheckout(...resourceStates: SourceControlResourceState[]): Promise<void> {
    let param: string | null = this.argsToString.apply(this, resourceStates);
    if (!param) {
      return;
    }
    await this._clearCase.undoCheckOut(param);
    await this.updateResourceGroups();
  }

  @command('clearcase.mkelem')
  async mkelem(...resourceStates: SourceControlResourceState[]): Promise<void> {
    let param: string | null = this.argsToString.apply(this, resourceStates);
    if (!param) {
      return;
    }
    await this._clearCase.mkelem(param);
    await this.updateResourceGroups();
}

  private createCommand(id: string, key: string, method: Function): (...args: any[]) => any {
    const result: (...args: any[]) => Promise<any> = (...args) => {
      const result: Promise<any> = Promise.resolve(method.apply(this, args));

      return result.catch(async err => {
        let message: string = err.message;
        if (!message) {
          this.outputChannel.appendLine(err);
        } else {
          this.outputChannel.appendLine(message);
        }
        this.updateResourceGroups();
      });
    };

    // patch this object, so people can call methods directly
    this[key] = result;

    return result;
  }

  dispose(): void {
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
  }
}
