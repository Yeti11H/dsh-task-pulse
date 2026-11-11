# Implementation plan

1. Check the current published DSH plugin, Client, and transport contracts. Pin the first verified release.
2. Implement normalized events and bounded per-session state, with behavior tests.
3. Implement disposable Host observation and read-only snapshot transport.
4. Implement the sidebar and its configurable silence threshold using the host's existing React runtime.
5. Build the package, test real DSH activation and tool observation, and verify the browser view.
6. Write installation, compatibility, limitations, and publishing instructions. Produce the installable tarball and source archive.

Earlier conversation already explored alternatives and approved this narrow sidebar design. Continue implementation under that authorization.
