export type HtmlNode = {
	tag: string;
	id?: string;
	content: string;
	children: HtmlNode[];
};

export type Binding = {
    id: string;
    expression: string;
    node: HtmlNode;
}

export type Variable = {
    name: string;
    startingValue: string;
    bindings: Binding[];
}