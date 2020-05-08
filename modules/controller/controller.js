(window.navigator.plugins.namedItem('Native Client') !== null) 
	&& nw.Window.get().showDevTools();
const os = require("os");
const pkg = require("../../package");
const {FlowRPC} = require("flow-ux/flow-rpc");
const Manager = require("../../lib/manager.js");
const Console = require("../../lib/console.js")

import {html, render} from 'lit-html';
import {repeat} from 'lit-html/directives/repeat.js';
import {FlowDialog, i18n, getLocalSetting, setLocalSetting, T} from '/node_modules/flow-ux/flow-ux.js';
window.testI18n = (testing)=>i18n.setTesting(!!testing);
window.getLocalSetting = getLocalSetting;
window.setLocalSetting = setLocalSetting;


class Controller{
	constructor(){
		testDialogs();
		this.debug = getLocalSetting('debug-ctx')==1;
		this.init();
	}
	
	async init(){
		this.initWin();
		this.initTrayMenu();
		this.initRPC();
		this.initI18n();
		this.initTheme();
		await this.initManager();
		await this.initConsole();
		this.taskTabs = {};
		this.taskTerminals = {};
		this.initCaption();
		await this.initSettings();
		this.setUiLoading(false);
	}
	setUiLoading(loading){
		document.body.classList.toggle("ui-loading", loading);
	}
	setUiDisabled(disabled){
		document.body.classList.toggle("disable", disabled);
	}
	initRPC(){
		let rpc = new FlowRPC({bcastChannel:'kdx'});
		this.rpc = rpc;

		rpc.on("disable-ui", (args)=>{
			this.setUiDisabled(true)
		});
		rpc.on("enable-ui", (args)=>{
			this.setUiDisabled(false)
		});
	}
	async initI18n(){
		window.addEventListener("flow-i18n-entries-changed", e=>{
			let {entries} = e.detail;
			console.log("entries", entries)
			this.post("set-app-i18n-entries", {entries})
		});
		let {entries} = await this.get("get-app-i18n-entries");
		//console.log("entries", entries)
		//let ce = new CustomEvent("flow-i18n-entries", {detail:{entries}})
		//window.dispatchEvent(ce)
		i18n.setActiveLanguages(['en', 'ja', 'ru']);
		i18n.setEntries(entries);
		this.post("set-app-i18n-entries", {entries:i18n.getEntries()})
		//i18n.setTesting(true);
	}
	async initManager(){
		this.initData = await this.get("get-app-data");
		let {dataFolder, appFolder} = this.initData;
		let manager = global.manager || new Manager(this, dataFolder, appFolder);
		if(global.manager){
			manager.controller = this;
			manager.dataFolder = dataFolder;
			manager.appFolder = appFolder;
		}

		this.manager = manager;
		manager.on("task-info", async (daemon)=>{
			if(!daemon.renderModuleInfo)
				return

			let {task} = daemon;

			let info = await daemon.renderModuleInfo(html);
			let section = html`<div class="task-info">${info}</div>`;
			this.renderModuleInfo(task, section);
		})
		manager.on("task-start", (daemon)=>{
			console.log("init-task:task", daemon.task)
			this.initTaskTab(daemon.task);

		});
		manager.on("task-exit", (daemon)=>{
			console.log("task-exit", daemon.task)
			this.removeTaskTab(daemon.task);
		})
		manager.on("task-data", (daemon, data)=>{
			//console.log("task-data", daemon.task, data)
			let terminal = this.taskTerminals[daemon.task.key];
			if(!terminal || !terminal.term)
				return
			//data.map(d=>{
				//console.log("data-line", d.trim())
				terminal.term.write(data.toString('utf8').replace(/\n/g,'\r\n')); //(d.trim());
			//});
		});

		if(global.manager){
			let {config:daemons} = await this.get("get-modules-config");
			if(!daemons)
				return "Could Not load modules."
			console.log("restartDaemons", daemons)
			this.restartDaemons(daemons);
		}else{
			this.initDaemons();
		}

		global.manager = manager;
	}
	async initConsole() {
		this.console = new Console(this, document.getElementById('kdx-console'));
		return Promise.resolve();
	}
	async initTheme(){
		let {theme, invertTerminals} = await this.get("get-app-config");
		this.setTheme(theme || 'light');
		this.setInvertTerminals(!!invertTerminals);
	}
	setInvertTerminals(invertTerminals){
		this.invertTerminals = invertTerminals;
		this.post("set-invert-terminals", {invertTerminals});
		document.body.classList.toggle("invert-terminals", invertTerminals)
		document.body.dispatchEvent(new CustomEvent("flow-theme-changed"));
	}
	setRunInBG(runInBG){
		this.runInBG = !!runInBG;
		this.post("set-run-in-bg", {runInBG});
	}
	setTheme(theme){
		this.theme = theme;
		if(this.caption)
			this.caption.logo = `/resources/images/kaspa-logo-${theme}-bg.png`
		this.post("set-app-theme", {theme});
		document.body.classList.forEach(c=>{
			if(c.indexOf('flow-theme') === 0 && c!='flow-theme'+theme){
				document.body.classList.remove(c);
			}
		})

		document.body.classList.add("flow-theme-"+theme)

		if(this.configEditor){
			if(this.theme == 'dark')
				this.configEditor.setTheme("ace/theme/tomorrow_night_eighties");
			else
				this.configEditor.setTheme("ace/theme/chrome");
		}

		document.body.dispatchEvent(new CustomEvent("flow-theme-changed"));
	}
	initCaption(){
		let caption = document.querySelector('flow-caption-bar');
		this.caption = caption;
		this.caption.close = this.closeWin;
		this.caption.logo = `/resources/images/kaspa-logo-${this.theme}-bg.png`;

		caption.version = pkg.version;

		caption.tabs = [{
			title : "Home".toUpperCase(),
			id : "home",
			cls: "home"
		},{
			title : "Settings".toUpperCase(),
			id : "settings"
		},{
			title : "Console".toUpperCase(),
			id : "console",
			disable:true,
			section: 'advanced'
		}];

		caption["active"] = "home";
	}
	initTrayMenu() {
		let tray = new nw.Tray({
			icon: 'resources/images/tray-icon.png',
			alticon:'resources/images/tray-icon.png',
			iconsAreTemplates: false
		});

		this.tray = tray;

		if(os.platform != 'darwin')
			tray.title = 'KDX';

		let debugMenu = new nw.Menu();
		let debugItems = {
			'Data' : 'DATA.debug',
			'Main' : () => {
				chrome.developerPrivate.openDevTools({ 
					renderViewId: -1, 
					renderProcessId: -1, 
					extensionId: chrome.runtime.id 
				})
			}
		};

		Object.entries(debugItems).forEach(([k,v]) => {
			debugMenu.append(new nw.MenuItem({
				label: k,
				click : () => {
					if(typeof(v) == 'string'){
						//this.rpc.publish(v)
						return
					}

					if(typeof(v) == 'function')
						v();
				}
			}))
		})

		let menu = new nw.Menu();

		if(this.isDevMode()) {
			menu.append(new nw.MenuItem({ 
				label : 'Debug',
				submenu : debugMenu
			}));
			
			menu.append(new nw.MenuItem({ 
				type : 'separator'
			}));
		}


		this.showMenu = new nw.MenuItem({ 
			label : 'Show',
			enabled: false,
			click : () => {
				this.showWin();
			}
		})

		menu.append(this.showMenu);

		menu.append(new nw.MenuItem({ 
			label : 'Exit',
			click : () => {
				this.exit();
			}
		}));

		tray.menu = menu;
	}

	async initSettings(){
		const doc = document;
		const qS = doc.querySelector.bind(doc);
		let themeInput = qS("#settings-dark-theme");
		let invertTermInput = qS("#settings-invert-terminal");
		let runInBGInput = qS("#settings-run-in-bg");
		let scriptHolder = qS('#settings-script');
		let advancedInput = qS('#settings-advanced');
		advancedInput.addEventListener('changed', (e)=>{
			let advanced = e.detail.checked;
			let index = this.caption.tabs.forEach((t, index)=>{
				if(t.section == 'advanced'){
					this.caption.set(`tabs.${index}.disable`, !advanced)
				}
			});

			localStorage.advancedUI = advanced?1:0;
			
			scriptHolder.classList.toggle("active", advanced)
			doc.body.classList.toggle("advanced-ui", advanced)
		});
		advancedInput.setChecked(localStorage.advancedUI==1);
		this.configEditor = ace.edit(scriptHolder.querySelector(".script-box"), {
			mode : 'ace/mode/javascript',
			selectionStyle : 'text'
		});
		if(this.theme == 'dark')
			this.configEditor.setTheme("ace/theme/tomorrow_night_eighties");
		else
			this.configEditor.setTheme("ace/theme/dawn");
		this.configEditor.setOptions({
			fontSize: "14px",
			fontFamily: "Source Code Pro"
		});
		
		this.configEditor.session.setUseWrapMode(false);
		this.configEditor.session.on('change', (delta) => {
			//let script = this.configEditor.session.getValue();
		});
		let {config, configFolder, modules} = this.initData;
		this.disableConfigUpdates = true;
		this.configEditor.session.setValue(JSON.stringify(modules, null, "\t"));
		this.disableConfigUpdates = false;
		$("flow-btn.save-config").on("click", ()=>{
			let config = this.configEditor.session.getValue();
			this.saveModulesConfig(config);
		})

		let $folderInput = $("#data-folder-input");
		let folderInput = $folderInput[0];
		let originalValue = config.dataDir || configFolder;
		folderInput.value = originalValue;
		$(".reset-data-dir").on("click", e=>{
			folderInput.setValue(originalValue);
		});
		$(".apply-data-dir").on("click", async(e)=>{
			this.setUiDisabled(true);
			let err = await this.get("set-app-data-dir", {dataDir:folderInput.value});
			console.log("err:", err)
			this.setUiDisabled(false);
		});
		$(".use-default-data-dir").on("click", e=>{
			folderInput.setValue(configFolder);
		});
		$folderInput.on("change", (e)=>{
			let value = folderInput.value;
			console.log(originalValue, value);
			$('.data-folder-input-tools').toggleClass("active", value!=originalValue);
			$(".apply-data-dir").attr('disabled', value?null:true);
			$('.use-default-data-dir')[0].disabled = value==configFolder;
		});

		themeInput.addEventListener('changed', (e)=>{
			let theme = e.detail.checked ? 'dark' : 'light';
			this.setTheme(theme);
		});
		invertTermInput.addEventListener('changed', (e)=>{
			this.setInvertTerminals(e.detail.checked);
		});
		runInBGInput.addEventListener('changed', (e)=>{
			this.setRunInBG(e.detail.checked);
		});

		themeInput.checked = config.theme == 'dark';
		invertTermInput.checked = !!config.invertTerminals;
		runInBGInput.checked = !!config.runInBG;
		this.runInBG = runInBGInput.checked;
	}
	initTaskTab(task){
		const advanced = document.querySelector('#settings-advanced').checked;
		const {key, name} = task;
		if(key.indexOf("simulator")===0)
			return;
		const {caption} = this;
		let tab = caption.tabs.find(t=>t.id == key);
		//console.log("tab", tab, key, name)
		
		let lastValue = caption.cloneValue(caption.tabs);
		if(tab){
			tab.disable = !advanced;
			console.log("tab.disable", tab)
		}else{
			caption.tabs.push({
				title:name,
				id:key,
				section:'advanced',
				disable:!advanced,
				render:()=>{
					//console.log("renderTab:",task);

					if(task?.impl?.renderTab)
						return task.impl.renderTab(html, T);

					return html`
						<div style="display:flex;flex-direction:row;">
							<div style="font-size:18px;"><flow-i18n>${task.type}</flow-i18n></div>
							<div style="font-size:10px; margin-top:8px;">${task.id}</div>
						</div>`;
				}
			});
		}
		
		this.taskTabs[key] = document.querySelector(`tab-content[for="${key}"]`);
		if(!this.taskTabs[key]){
			const template = document.createElement('template');
			template.innerHTML = 
			`<tab-content for="${key}" data-active-display="flex" class="advanced term">
				<flow-terminal noinput class="x-terminal" background="transparent" foreground="transparent"></flow-terminal>
				<div class="tools">
					<flow-btn data-action="RUN">RUN</flow-btn>
					<flow-btn data-action="STOP">STOP</flow-btn>
					<flow-btn data-action="RESTART">RESTART</flow-btn>
					<flow-btn data-action="PURGE_DATA">PURGE DATA</flow-btn>
				</div>
			</tab-content>`
			let tabContent = template.content.firstChild;
			tabContent.querySelector(".tools").addEventListener('click', e=>{
				this.onToolsClick(e);
			});
			this.taskTabs[key] = tabContent;
			this.taskTerminals[key] = tabContent.querySelector("flow-terminal");
			document.body.appendChild(tabContent);
		}
		

		caption.requestUpdate('tabs', lastValue)
	}
	removeTaskTab(task){
		const {key, name} = task;
		const {caption} = this;
		let newTabs = caption.tabs.filter(t=>t.id != key);
		//console.log("lastValue", caption.tabs.slice(0), newTabs.slice(0))
		let tabContent = this.taskTabs[key];
		if(tabContent && tabContent.parentNode)
			document.body.removeChild(tabContent);

		if(newTabs.length == caption.tabs.length)
			return;
		let lastValue = caption.cloneValue(caption.tabs);

		caption.tabs = newTabs;

		caption.requestUpdate('tabs', lastValue)
	}
	async saveModulesConfig(config){
		//console.log("saveModulesConfig:config", config)
		try{
			config = JSON.parse(config);
		}catch(e){
			return
		}
		let {config:daemons} = await this.get("set-modules-config", {config});

		console.log("updatedConfig", daemons)
		if(daemons)
			this.restartDaemons(daemons);
	}
	onToolsClick(e){
		let $target = $(e.target).closest("[data-action]");
		let $tabContent = $target.closest("tab-content");
		let key = ($tabContent.attr("for")+"").replace(/\-/g, ":");
		let action = $target.attr("data-action");
		if(!action || !$tabContent.length)
			return

		console.log("onToolsClick:TODO", action, key)
	}
	async initDaemons(daemons){
		if(!daemons){
			let {config} = await this.get("get-modules-config");
			if(!config)
				return "Could Not load modules."
			daemons = config;
		}
			
		console.log("initDaemons", daemons)
		this.manager.start(daemons);
	}
	async restartDaemons(daemons){
		try{
			await this.manager.stop();
			console.log("initDaemons....")
			dpc(1000, ()=>{
				this.initDaemons(daemons);
			});
		}catch(e){
			console.log("restartDaemons:error", e)
			dpc(1000, ()=>{
				this.initDaemons(daemons);
			});
		}
	}
	async stopDaemons(){
		if(!this.manager)
			return true;
		try{
			await this.manager.stop();
		}catch(e){
			console.log("manager.stop:error", e)
			return false;
		}

		return true;
	}
	post(subject, data){
		this.rpc.dispatch(subject, data)
	}
	get(subject, data){
		return new Promise((resolve, reject)=>{
			this.rpc.dispatch(subject, data, (err, result)=>{
				this.debug && console.log("subject:err, result", subject, err, result)
				if(err)
					return resolve(err)

				resolve(result);
			})
		})
	}
	redraw() {
		this?.caption?.requestUpdate();
	}
	renderModuleInfo(task, info){
		this._infoTable = this._infoTable || document.querySelector("#process-info-table");
		this._taskInfo = this._taskInfo || {};
		
		this._taskInfo[task.key] = info;
		let list = Object.entries(this._taskInfo);
		render(repeat(list, ([k])=>k, ([k, info])=>info), this._infoTable);
	}
	exit(){
		this.runInBG = false;
		this.closeWin(true);
	}
	initWin(){
		const win = nw.Window.get();
		this.win = win;
		const minimize = win.minimize.bind(win);
		win.minimize = ()=>{
			if(this.runInBG){
				this.hideWin();
				return
			}

			minimize();
		}

		this.closeWin = async(isExit)=>{
			console.log("%c######## closeWin called ######", 'color:red')
			if(isExit !== true && !this.runInBG){
				let {btn} = await FlowDialog.show({
					title:"Exit KDX",
					body:"Are you sure?",
					btns:['Cancel', 'Exit:primary']
				});
				if(btn != 'exit')
					return
			}
			if(!this.onbeforeunload())
				return

			//this.setUiDisabled(true);
			dpc(500, ()=>{
				window.onbeforeunload = null;
				win.close(true);
			})
		}

		win.on("close", ()=>this.closeWin());

		win.on("minimize", ()=>{
			if(this.showMenu)
				this.showMenu.enabled = true;
		})

		nw.App.on("reopen", ()=>{
			this.showWin();
		})

		this.onbeforeunload = ()=>{
			if(this.runInBG){
				this.hideWin();
				return false
			}

			this.stopDaemons();
			if(this.tray){
				this.tray.remove();
				this.tray = null;
			}

			return true;
		}

		//window.onbeforeunload = this.onbeforeunload
	}
	hideWin(){
		//window.onbeforeunload = null;
		if(this.showMenu)
			this.showMenu.enabled = true;
		this.win.hide();
	}
	showWin(){
		if(this.showMenu)
			this.showMenu.enabled = false;
		this.win.show();
		//window.onbeforeunload = this.onbeforeunload
	}
	isDevMode() {
	    return (window.navigator.plugins.namedItem('Native Client') !== null);
	}
}

console.log("global.manager::::", global.manager)
window.addEventListener("WebComponentsReady", ()=>{
	let uiCtl = new Controller();
	window.xxxxuiCtl = uiCtl;
})

