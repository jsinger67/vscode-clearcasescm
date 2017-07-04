'use strict';

import { OutputChannel, window } from 'vscode';
import * as path from 'path';
import * as cp from 'child_process';
import * as nls from 'vscode-nls';

const localize: nls.LocalizeFunc = nls.loadMessageBundle();

enum ViewType {
  UNKNOWN,
  DYNAMIC,
  SNAPSHOT
}

export class ClearCase {
  private readonly CT : string = 'cleartool ';
  private readonly CI : string = 'ci ';
  private readonly CO : string = 'co -nc ';
  private readonly UN_CO : string = 'unco -keep ';
  private readonly MKELEM : string = 'mkelem -nco ';
  private readonly DESCR : string = 'describe -short ';
  private readonly LS_ELEMS : string = 'ls -vob -r -s ';
  private readonly LS_CO : string = 'lsco -s -r ';
  private readonly LS_VIEW : string = 'lsview -cview -long ';
  private readonly LS_VTREE : string = 'lsvtree -g ';
  private readonly LS_PRIV_DYN : string = 'lspriv ';
  private readonly LS_PRIV_SNP : string = 'ls -r -view_only ';

  private readonly rxViewType = new RegExp('\\.(vws|stg)$', 'i');

  constructor(
    private outputChannel : OutputChannel,
    private workspaceRootPath : string
  ) {
  }

  private runCleartoolCommand(cmd : string): Promise<string[]> {
    let thisArg: ClearCase = this;
    // tslint:disable-next-line:typedef
    return new Promise<string[]>(function(resolve, reject): void {
      thisArg.outputChannel.appendLine(cmd);
      cp.exec(thisArg.CT + cmd, (err : Error, output : string) => {
        if (err) {
          let msg = localize('ClearCase error', 'ClearCase error: {0}', err.message);
          thisArg.outputChannel.appendLine(msg);
          reject(msg);
        } else {
          resolve(output.split(/\r\n|\r|\n/).filter(s => s.length > 0));
        }
      });
    });
  }

  private startCleartoolCommand(cmd : string): Promise<void> {
    let thisArg: ClearCase = this;
    // tslint:disable-next-line:typedef
    return new Promise<void>(function(resolve, reject): void {
      thisArg.outputChannel.appendLine(cmd);
      cp.exec(thisArg.CT + cmd, (err : Error, output : string) => {
        if (err) {
          let msg = localize('ClearCase error', 'ClearCase error: {0}', err.message);
          thisArg.outputChannel.appendLine(msg);
          reject(msg);
        } else {
          resolve();
        }
      });
    });
  }

  private async detectViewType(): Promise<ViewType> {
    process.chdir(this.workspaceRootPath);
    let lines: string[] = await this.runCleartoolCommand(this.LS_VIEW);
    let filterGlobalPathLines:(l: string) => boolean = (l: string) => {
      if (l.length === 0) {
        return false;
      }
      let ma: RegExpMatchArray | null = l.match(this.rxViewType);
      return !!ma && (ma.length > 0);
    };

    let resLines: string[] = lines.filter(filterGlobalPathLines);
    if (resLines.length === 0) {
      return ViewType.UNKNOWN;
    }
    if (resLines[0].endsWith('.vws')) {
      return ViewType.DYNAMIC;
    } else {
      return ViewType.SNAPSHOT;
    }
  }

  public async listCheckedOuts(): Promise<string[]> {
    return await this.runCleartoolCommand(this.LS_CO + this.doubleQuote(this.workspaceRootPath));
  }

  public async listElements(): Promise<string[]> {
    return await this.runCleartoolCommand(this.LS_ELEMS + this.doubleQuote(this.workspaceRootPath));
  }

  public async listViewPrivates(): Promise<string[]> {
    let vtype: ViewType = await this.detectViewType();
    let cmd: string = '';
    switch (vtype) {
      case ViewType.DYNAMIC:
        cmd = this.LS_PRIV_DYN;
        break;
      case ViewType.SNAPSHOT:
        cmd = this.LS_PRIV_SNP;
        break;
      case ViewType.UNKNOWN:
        throw localize('unknown view type', 'Unknown view type!');
    }
    let privs = await this.runCleartoolCommand(cmd + this.doubleQuote(this.workspaceRootPath));
    return privs.filter(p => !p.endsWith('[checkedout]'));
  }

  public async showVersionTree(filePath: string): Promise<void> {
    return await this.startCleartoolCommand(this.LS_VTREE + filePath);
  }

  public async checkIn(filePath: string, comment: string): Promise<void> {
    let params = filePath;
    if (comment.length > 0) {
      params = ' -c ' + comment;
    } else {
      params = '-nc ' + params;
    }

    return await this.startCleartoolCommand(this.CI + params);
  }

  public async checkOut(filePath: string): Promise<void> {
    return await this.startCleartoolCommand(this.CO + filePath);
  }

  public async undoCheckOut(filePath: string): Promise<void> {
    return await this.startCleartoolCommand(this.UN_CO + filePath);
  }

  public async isCheckedOut(filePath: string): Promise<boolean> {
    let res:string[] = await this.runCleartoolCommand(this.DESCR + this.doubleQuote(filePath));
    if (!res || res.length === 0) {
      return false;
    }
    return res[0].endsWith('CHECKEDOUT');
  }

  public async mkelem(filePath: string): Promise<void> {
    window.showWarningMessage(localize('not supported command', 'Not (yet) supported command'));

    // if (!this.isCheckedOut(path.dirname(filePath))) {
    //   await this.checkOut(path.dirname(filePath));
    // }
    // return await this.startCleartoolCommand(this.MKELEM + filePath);
  }

  private doubleQuote(s: string): string {
    if (s.startsWith('"')) {
      return s;
    }
    return `"${s}"`;
  }
}