import * as JSZip from 'jszip';
import { MalformedFileError } from '../errors';
import { MimeType } from '../mimeType';
import { Binary } from '../utils';
import { XmlNode, XmlParser } from '../xml';
import { ContentTypesFile } from './contentTypesFile';
import { MediaFiles } from './mediaFiles';
import { Rels } from './rels';

/**
 * Represents a single docx file.
 */
export class Docx {

    public get documentPath(): string {

        if (!this._documentPath) {

            if (this.zip.files["word/document.xml"]) {
                this._documentPath = "word/document.xml";
            }

            // https://github.com/open-xml-templating/docxtemplater/issues/366
            else if (this.zip.files["word/document2.xml"]) {
                this._documentPath = "word/document2.xml";
            }
        }

        return this._documentPath;
    }

    private _documentPath: string;
    private _document: XmlNode;

    private readonly rels: Rels;
    private readonly mediaFiles: MediaFiles;
    private readonly contentTypes: ContentTypesFile;

    constructor(
        private readonly zip: JSZip,
        private readonly xmlParser: XmlParser
    ) {
        if (!this.documentPath)
            throw new MalformedFileError('docx');

        this.rels = new Rels(this.documentPath, zip, xmlParser);
        this.mediaFiles = new MediaFiles(zip);
        this.contentTypes = new ContentTypesFile(zip, xmlParser);
    }

    //
    // public methods
    //

    /**
     * The xml root of the main document file.
     */
    public async getDocument(): Promise<XmlNode> {
        if (!this._document) {
            const xml = await this.zip.files[this.documentPath].async('text');
            this._document = this.xmlParser.parse(xml);
        }
        return this._document;
    }

    /**
     * Get the text content of the main document file.
     */
    public async getDocumentText(): Promise<string> {
        const xmlDocument = await this.getDocument();

        // ugly but good enough...
        const xml = this.xmlParser.serialize(xmlDocument);
        const domDocument = this.xmlParser.domParse(xml);

        return domDocument.documentElement.textContent;
    }

    /**
     * Add a media resource to the document archive and return the created rel ID.
     */
    public async addMedia(content: Binary, type: MimeType): Promise<string> {

        const mediaFilePath = await this.mediaFiles.add(content, type);
        const relId = await this.rels.add(mediaFilePath, type);
        await this.contentTypes.ensureContentType(type);
        return relId;
    }

    public async export<T extends Binary>(outputType: Constructor<T>): Promise<T> {
        await this.saveChanges();
        const zipOutputType: JSZip.OutputType = Binary.toJsZipOutputType(outputType);
        const output = await this.zip.generateAsync({
            type: zipOutputType,
            compression: "DEFLATE",
            compressionOptions: {
                level: 6 // between 1 (best speed) and 9 (best compression)
            }
        });
        return output as T;
    }

    //
    // private methods
    //        

    private async saveChanges() {

        // save main document
        const document = await this.getDocument();
        const xmlContent = this.xmlParser.serialize(document);
        this.zip.file(this.documentPath, xmlContent);

        // save other parts
        await this.rels.save();
        await this.contentTypes.save();
    }
}