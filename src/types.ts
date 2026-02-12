export type HtmlNode = {
	tag: string;
	id?: string;
    displayIf?:string;
    bind?: string;
	content: string;
	children: HtmlNode[];
};

export type Binding = {
    id: string;
    expression: string;
    node: HtmlNode;
    variables: string[];
}

export type Variable = {
    name: string;
    startingValue: string;
    bindings: Binding[];
}