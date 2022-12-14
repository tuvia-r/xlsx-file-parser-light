import jszip from 'jszip';
import { Sheet } from "../sheet/sheet";
import XMLDOM from "xmldom";
import { getCellCoords, select } from "../utils";
import { Cell } from "../sheet/parts/cell";

const NA = {
	textContent: "",
};

export interface ParsedFile {
	name: string;
	contents: string;
}

export class XLSXParser {
	private filesParsed: ParsedFile[] = [];

	public sheets: Sheet[] = [];

	constructor(private buffer: Buffer) {
		if (this.buffer instanceof ArrayBuffer) {
			this.buffer = Buffer.from(this.buffer);
		}
	}

	async parse() {
		await this.unpack();
		return this.parseSheets();
	}

	private async unpack() {
		const dir = await jszip.loadAsync(this.buffer)
		const files = []
		dir.forEach((path, file) => files.push({path, file}))

		this.filesParsed = await Promise.all(
			files.map(async (file) => ({
				name: file.path,
				contents: await file.file.async('string'),
			}))
		);

		return this.filesParsed;
	}

	private findSheets() {
		return this.filesParsed.filter((file) =>
			file.name.startsWith("xl/worksheets/sheet")
		);
	}

	private getSharedStringsFile() {
		return this.filesParsed.find(
			(file) => file.name === "xl/sharedStrings.xml"
		);
	}

	private parseData(
		value: any,
		type: string,
		values: string[]
	) {
		switch (type) {
			case "s":
				return values[parseInt(value ?? "")].trim()
					.length > 0
					? values[parseInt(value ?? "")]
					: undefined;
			case "b":
				return value === 1 ? true : false;
			case "str":
				return value.trim().length > 0
					? value
					: undefined;
			case "":
				return Number.isFinite(Number(value)) &&
					!Number.isNaN(Number(value))
					? Number(value)
					: value;
			default:
				return value;
		}
	}

	private parseCell(node: Element, values: string[]) {
		const r = node.getAttribute("r");
		const type = node.getAttribute("t") || "";
		const value = (
			[select("a:v", node) || NA]
				.flat()
				.pop() as Element
		)?.textContent;
		const coords = getCellCoords(r as string);

		return new Cell({
			...coords,
			data: this.parseData(value, type, values),
			type,
		});
	}

	private extractSheetName(sheetFile: ParsedFile) {
		return sheetFile.name
			.replace("xl/worksheets/sheet", "")
			.replace(".xml", "");
	}

	private parseSheets() {
		const sheets = this.findSheets();
		const sharedStrings = this.getSharedStringsFile();

		if (sheets.length === 0 || !sharedStrings) {
			throw new Error(`can't parse`);
		}

		const sharedStringsXml =
			new XMLDOM.DOMParser().parseFromString(
				sharedStrings?.contents
			);
		const sharedValues = select(
			"//a:si",
			sharedStringsXml
		).map((string) =>
			select(
				".//a:t[not(ancestor::a:rPh)]",
				string as Node
			)
				.map((t: any) => t.textContent)
				.join("")
		);

		for (const sheetFile of sheets) {
			const sheetXml =
				new XMLDOM.DOMParser().parseFromString(
					sheetFile.contents.toString()
				);
			const cellNodes = select(
				"/a:worksheet/a:sheetData/a:row/a:c",
				sheetXml
			) as Element[];

			const cells = cellNodes
				.map((cell) =>
					this.parseCell(cell, sharedValues)
				)
				.filter((c) => c.data !== undefined);

			this.sheets.push(
				new Sheet({
					cells: cells,
					name: this.extractSheetName(sheetFile),
				})
			);
		}
		return this.sheets;
	}
}
