export type HtmlNode = {
	tag: string;
	id?: string;
    displayIf?: string;
    classBinding?: string;
    bind?: string;
    onInput?: string;
    onClick?: string;
    for?: string;
	content: string;
	children: HtmlNode[];
};

export type Binding = {
    id: string;
    expression: string;
    node: HtmlNode;
    variables: string[];
    type: 'display-if' | 'text' | 'class';
}

export type Variable = {
    name: string;
    startingValue: string;
    bindings: Binding[];
}