import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { Context } from "shared/Context";
import { ClusterType, ProjectType } from "shared/types";
import { pushFiltered } from "shared/routing";
import { useHistory, useLocation } from "react-router";

const OptionsDropdown: React.FC = ({ children }) => {
  const [isOpen, setIsOpen] = useState(false);

  const handleClick = (e: any) => {
    e.stopPropagation();
    setIsOpen(true);
  };

  const handleOnBlur = () => {
    setIsOpen(false);
  };

  return (
    <OptionsButton onClick={handleClick} onBlur={handleOnBlur}>
      <i className="material-icons-outlined">more_vert</i>
      {isOpen && <DropdownMenu>{children}</DropdownMenu>}
    </OptionsButton>
  );
};

const useWebsocket = (
  currentProject: ProjectType,
  currentCluster: ClusterType
) => {
  const wsRef = useRef<WebSocket | undefined>(undefined);

  useEffect(() => {
    let protocol = window.location.protocol == "https:" ? "wss" : "ws";
    wsRef.current = new WebSocket(
      `${protocol}://${window.location.host}/api/projects/${currentProject.id}/k8s/namespace/status?cluster_id=${currentCluster.id}`
    );

    wsRef.current.onopen = () => {
      console.log("Connected to websocket");
    };

    wsRef.current.onclose = () => {
      console.log("closing websocket");
    };

    return () => {
      wsRef.current.close();
    };
  }, []);

  return wsRef;
};

export const NamespaceList: React.FunctionComponent = () => {
  const {
    currentCluster,
    currentProject,
    setCurrentModal,
    setCurrentError,
  } = useContext(Context);
  const location = useLocation();
  const history = useHistory();
  const [namespaces, setNamespaces] = useState([]);
  const websocket = useWebsocket(currentProject, currentCluster);
  const onDelete = (namespace: any) => {
    setCurrentModal("DeleteNamespaceModal", namespace);
  };

  const isAvailableForDeletion = (namespaceName: string) => {
    // Only the namespaces that doesn't start with kube- or has by name default will be
    // available for deletion (as those are the k8s namespaces)
    return !/(^default$)|(^kube-.*)/.test(namespaceName);
  };

  useEffect(() => {
    if (!websocket) {
      return;
    }

    websocket.current.onerror = (err: ErrorEvent) => {
      setCurrentError(err.message);
      websocket.current.close();
    };

    websocket.current.onmessage = (evt: MessageEvent) => {
      const data = JSON.parse(evt.data);
      if (data.Kind !== "namespace") {
        return;
      }
      if (data.event_type === "ADD") {
        setNamespaces((oldNamespaces) => [...oldNamespaces, data.Object]);
      }

      if (data.event_type === "DELETE") {
        setNamespaces((oldNamespaces) => {
          const oldNamespaceIndex = oldNamespaces.findIndex(
            (namespace) => namespace.metadata.name === data.Object.metadata.name
          );
          oldNamespaces.splice(oldNamespaceIndex, 1);
          return [...oldNamespaces];
        });
      }

      if (data.event_type === "UPDATE") {
        setNamespaces((oldNamespaces) => {
          const oldNamespaceIndex = oldNamespaces.findIndex(
            (namespace) => namespace.metadata.name === data.Object.metadata.name
          );
          oldNamespaces.splice(oldNamespaceIndex, 1, data.Object);
          return oldNamespaces;
        });
      }
    };
  }, [websocket]);

  const sortedNamespaces = useMemo<any[]>(() => {
    return [...namespaces].sort((prev, current) => {
      const prevName = prev.metadata.name;
      const currentName = current.metadata.name;

      if (
        isAvailableForDeletion(prevName) &&
        !isAvailableForDeletion(currentName)
      ) {
        return -1;
      } else if (
        !isAvailableForDeletion(prevName) &&
        isAvailableForDeletion(currentName)
      ) {
        return 1;
      } else {
        return 0;
      }
    });
  }, [namespaces]);

  return (
    <NamespaceListWrapper>
      <ControlRow>
        <Button
          onClick={() =>
            setCurrentModal(
              "NamespaceModal",
              namespaces.map((namespace) => ({
                value: namespace.metadata.name,
              }))
            )
          }
        >
          <i className="material-icons">add</i> Add namespace
        </Button>
      </ControlRow>
      <NamespacesGrid>
        {sortedNamespaces.map((namespace) => {
          return (
            <StyledCard
              key={namespace?.metadata?.name}
              onClick={() =>
                pushFiltered(
                  { location, history },
                  `/applications/${currentCluster.name}/${namespace.metadata.name}`,
                  [],
                  {}
                )
              }
            >
              <ContentContainer>
                {namespace?.metadata?.name}
                <Status margin_left={"0px"}>
                  <StatusColor status={namespace.status.phase} />
                  {namespace?.status?.phase}
                </Status>
              </ContentContainer>
              {isAvailableForDeletion(namespace?.metadata?.name) && (
                <OptionsDropdown>
                  <DropdownOption onClick={() => onDelete(namespace)}>
                    <i className="material-icons-outlined">delete</i>
                    <span>Delete</span>
                  </DropdownOption>
                </OptionsDropdown>
              )}
            </StyledCard>
          );
        })}
      </NamespacesGrid>
    </NamespaceListWrapper>
  );
};

const NamespaceListWrapper = styled.div`
  margin-top: 35px;
  padding-bottom: 80px;
`;

const NamespacesGrid = styled.div`
  margin-top: 32px;
  padding-bottom: 150px;
  display: grid;
  grid-column-gap: 25px;
  grid-row-gap: 25px;
  grid-template-columns: repeat(2, minmax(200px, 1fr));
`;

const StatusColor = styled.div`
  margin-top: 1px;
  width: 8px;
  height: 8px;
  background: ${(props: { status: string }) =>
    props.status === "Active"
      ? "#4797ff"
      : props.status === "Terminating"
      ? "#ed5f85"
      : "#f5cb42"};
  border-radius: 20px;
  margin-left: 3px;
  margin-right: 16px;
`;

const Status = styled.div`
  display: flex;
  height: 20px;
  font-size: 13px;
  flex-direction: row;
  text-transform: capitalize;
  align-items: center;
  font-family: "Work Sans", sans-serif;
  color: #aaaabb;
  animation: fadeIn 0.5s;
  margin-left: ${(props: { margin_left: string }) => props.margin_left};

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
`;

const ControlRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 35px;
  padding-left: 0px;
`;

const Button = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  cursor: pointer;
  font-family: "Work Sans", sans-serif;
  border-radius: 20px;
  color: white;
  height: 35px;
  padding: 0px 8px;
  padding-bottom: 1px;
  margin-right: 10px;
  font-weight: 500;
  padding-right: 15px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  box-shadow: 0 5px 8px 0px #00000010;
  cursor: ${(props: { disabled?: boolean }) =>
    props.disabled ? "not-allowed" : "pointer"};

  background: ${(props: { disabled?: boolean }) =>
    props.disabled ? "#aaaabbee" : "#616FEEcc"};
  :hover {
    background: ${(props: { disabled?: boolean }) =>
      props.disabled ? "" : "#505edddd"};
  }

  > i {
    color: white;
    width: 18px;
    height: 18px;
    font-weight: 600;
    font-size: 12px;
    border-radius: 20px;
    display: flex;
    align-items: center;
    margin-right: 5px;
    justify-content: center;
  }
`;

const StyledCard = styled.div`
  background: #26282f;
  min-height: 80px;
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border: 1px solid #26282f;
  box-shadow: 0 5px 8px 0px #00000033;
  border-radius: 5px;
  padding: 14px;
  animation: fadeIn 0.5s;
  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  transition: transform 0.2s ease-in-out, box-shadow 0.2s ease-in-out;
  :hover {
    transform: scale(1.05);
    box-shadow: 0 8px 20px 0px #00000030;
    cursor: pointer;
  }
`;

const ContentContainer = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  height: 100%;
`;

const OptionsButton = styled.button`
  position: relative;
  border: none;
  background: none;
  color: white;
  padding: 5px;
  display: flex;
  justify-content: center;
  align-items: center;
  border-radius: 50%;
  :hover {
    background: #32343a;
    cursor: pointer;
  }
`;

const DropdownMenu = styled.div`
  position: absolute;
  right: 25px;
  top: 10px;
  overflow: hidden;
  width: 120px;
  height: auto;
  background: #26282f;
  box-shadow: 0 8px 20px 0px #00000088;
`;

const DropdownOption = styled.div`
  width: 100%;
  height: 37px;
  font-size: 13px;
  cursor: pointer;
  padding-left: 10px;
  padding-right: 10px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: flex;
  justify-content: center;
  align-items: center;
  :hover {
    background: #ffffff22;
  }
  :not(:first-child) {
    border-top: 1px solid #00000000;
  }

  :not(:last-child) {
    border-bottom: 1px solid #ffffff15;
  }

  > i {
    margin-right: 5px;
    font-size: 16px;
  }
`;
