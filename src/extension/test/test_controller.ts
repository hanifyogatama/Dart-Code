import * as vs from "vscode";
import { IAmDisposable } from "../../shared/interfaces";
import { GroupNode, TestContainerNode, TestNode, TestTreeModel, TreeNode } from "../../shared/test/test_model";
import { disposeAll } from "../../shared/utils";

type DartTestNode = TreeNode | "ROOT";

export class DartTestController implements vs.TestController<DartTestNode>, IAmDisposable {
	private disposables: IAmDisposable[] = [];

	constructor(private readonly model: TestTreeModel) {
		this.disposables.push(model.onDidChangeTreeData.listen((node) => vs.test.onDidChangeTestResults));
	}
	
	public createWorkspaceTestRoot(workspace: vs.WorkspaceFolder): vs.TestItem<DartTestNode, DartTestNode> {
		const root = vs.test.createTestItem<DartTestNode>(
			{
				id: "ROOT",
				label: "Dart Tests",
			},
			"ROOT",
		);

		for (const suite of Object.values(this.model.suites)) {
			root.addChild(testItemBuilder.createNode(suite.node));
		}
		
		return root;
	}

	public runTests(request: vs.TestRunRequest<DartTestNode>, token: vs.CancellationToken): void | Thenable<void> {
		// throw new Error("Method not implemented.");
	}


	public dispose(): any {
		disposeAll(this.disposables);
	}
}

class TestItemBuilder {
	public createNode(node: TreeNode): vs.TestItem<DartTestNode> {
		if (node instanceof TestNode) {
			return vs.test.createTestItem<DartTestNode>(
				{
					id: `${node.suiteData.path}:${node.name}`,
					label: node.label,
					uri: vs.Uri.file(node.suiteData.path),
				},
				node,
			);
		}
		else if (node instanceof TestContainerNode) {
			const id = node instanceof GroupNode ? `${node.suiteData.path}:${node.name}` : node.suiteData.path;
			const item = vs.test.createTestItem<DartTestNode>(
				{
					id,
					label: node.label ?? "<unnamed>",
					uri: vs.Uri.file(node.suiteData.path),
				},
				node,
			);
			if (node.children) {
				for (const child of node.children) {
					item.addChild(this.createNode(child));
				}
			}
			return item;
		} else {
			throw `Unexpected tree node ${node}`;
		}
	}

}

const testItemBuilder = new TestItemBuilder();

